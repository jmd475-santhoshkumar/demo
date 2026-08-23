import json
import logging
import os
from typing import Any, Optional

from .base import LLMProvider, QuotaExceededError, ToolTurn, is_quota_error

logger = logging.getLogger("resourceiq.ai.azure_openai")

def _to_openai_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m["role"]
        if role in ("system", "user"):
            out.append({"role": role, "content": m.get("content") or ""})
        elif role == "assistant":
            if m.get("tool_calls"):
                out.append({
                    "role": "assistant",
                    "content": m.get("content"),
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])},
                        }
                        for tc in m["tool_calls"]
                    ],
                })
            else:
                out.append({"role": "assistant", "content": m.get("content") or ""})
        elif role == "tool":
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m.get("content") or ""})
    return out

class AzureOpenAIProvider(LLMProvider):
    @property
    def provider_name(self) -> str:
        return "azure_openai"

    def _client(self):
        endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
        api_key = os.environ.get("AZURE_OPENAI_API_KEY", "")
        if not endpoint or not api_key:
            return None
        # This resource's endpoint is Azure's newer OpenAI-compatible "v1" surface
        # (ends in /openai/v1) -- that flavor is addressed with the plain OpenAI
        # client (base_url + api_key), not the legacy AzureOpenAI client, which
        # expects a bare resource root and appends its own /openai/deployments/...
        # path + api-version query param, producing a 404 against this endpoint.
        from openai import OpenAI
        return OpenAI(base_url=endpoint, api_key=api_key)

    def generate_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> Optional[ToolTurn]:
        client = self._client()
        if client is None:
            return None
        deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT") or os.environ.get("AZURE_OPENAI_MODEL", "gpt-4o")
        try:
            openai_tools = [
                {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
                for t in tools
            ]
            create_kwargs: dict[str, Any] = dict(
                model=deployment,
                messages=_to_openai_messages(messages),
                temperature=temperature,
                max_tokens=max_tokens,
                **({"tools": openai_tools, "tool_choice": "auto"} if openai_tools else {}),
            )
            # Newer model families behind this same Chat Completions endpoint
            # (o1/o3/gpt-5-style deployments) reject a couple of "classic"
            # chat-completion params this app otherwise relies on: the legacy
            # `max_tokens` name (wants `max_completion_tokens` instead), and a
            # non-default `temperature` (only 1, the default, is accepted --
            # these models don't support a sampling-temperature knob at all).
            # Both are per-JMAN-deployment specifics this code shouldn't
            # hardcode, so adapt to whichever the API actually complains about
            # and retry, rather than assuming one fixed model family.
            for _attempt in range(2):
                try:
                    response = client.chat.completions.create(**create_kwargs)
                    break
                except Exception as e:
                    msg_text = str(e)
                    if "max_tokens" in create_kwargs and "max_completion_tokens" in msg_text:
                        create_kwargs["max_completion_tokens"] = create_kwargs.pop("max_tokens")
                    elif "temperature" in create_kwargs and "temperature" in msg_text and "default" in msg_text:
                        del create_kwargs["temperature"]
                    else:
                        raise
            else:
                response = client.chat.completions.create(**create_kwargs)

            msg = response.choices[0].message
            tool_calls = []
            for tc in msg.tool_calls or []:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                tool_calls.append({"id": tc.id, "name": tc.function.name, "arguments": args})

            return {"content": (msg.content or None) if not tool_calls else None, "tool_calls": tool_calls}
        except Exception as e:
            if is_quota_error(e):
                print(f"[AzureOpenAI] QUOTA EXCEEDED: {e}", flush=True)
                raise QuotaExceededError(str(e)) from e
            print(f"[AzureOpenAI] ERROR: {type(e).__name__}: {e}", flush=True)
            logger.warning("Azure OpenAI generate_with_tools failed: %s", e)
            return None
