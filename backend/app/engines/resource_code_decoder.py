
RESOURCE_CODE_MAP: dict[str, list[str]] = {
    "AC": ["Associate Consultant"],
    "AC (UK)": ["Associate Consultant"],
    "AP": ["Associate Partner"],
    "AP/P": ["Associate Partner", "Partner"],
    "C": ["Consultant"],
    "C/SAC/AC": ["Consultant", "Senior Associate Consultant", "Associate Consultant"],
    "EM": [],
    "Enabler": ["Solutions Enabler"],
    "GTM Architect": [],
    "M": ["Manager"],
    "P": ["Partner"],
    "PA": ["Principal Architect", "Principal"],
    "SAC": ["Senior Associate Consultant"],
    "SAC - C": ["Senior Associate Consultant", "Consultant"],
    "SAC or AC": ["Senior Associate Consultant", "Associate Consultant"],
    "SAC/AC": ["Senior Associate Consultant", "Associate Consultant"],
    "SC": ["Solutions Consultant", "Senior Consultant"],
    "SC (EM)": ["Solutions Consultant", "Senior Consultant"],
    "SC or C - EM": ["Solutions Consultant", "Consultant"],
    "SE": ["Software Engineer"],
    "SSE": ["Senior Software Engineer"],
    "SSE  or SE": ["Senior Software Engineer", "Software Engineer"],
    "SSE or SE": ["Senior Software Engineer", "Software Engineer"],
    "Snr Sol Con": ["Senior Solutions Consultant"],
    "Sol Con": ["Solutions Consultant", "Senior Consultant"],
    "Sol Con/Enabler/SSE": ["Solutions Consultant", "Solutions Enabler", "Senior Software Engineer"],
    "Sr DS SME": [],
    "Sr Sol Con": ["Senior Solutions Consultant"],

    # Added for the real "Demand file .xlsx" (confirmed with the user which
    # real designation(s) each new abbreviation means -- not guessed).
    "AC - Replacement": ["Associate Consultant"],
    "AC or SAC": ["Associate Consultant", "Senior Associate Consultant"],
    "AP & PA Oversight": ["Associate Partner", "Principal Architect"],
    "AP (US)": ["Associate Partner"],
    "Architect": ["Technical Solutions Architect", "Technology Solutions Architect", "Principal Architect", "Principal Technology Architect"],
    "C (EM)": ["Consultant"],
    "C or SAC": ["Consultant", "Senior Associate Consultant"],
    "C or strong SAC": ["Consultant", "Senior Associate Consultant"],
    "Data Scientist (AC/SAC, or Enabler)": ["Associate Consultant", "Senior Associate Consultant", "Solutions Enabler"],
    "Enabler or SSE": ["Solutions Enabler", "Senior Software Engineer"],
    "M/P": ["Manager", "Principal"],
    "M/SC": ["Manager", "Solutions Consultant"],
    "P/M/SC": ["Partner", "Manager", "Solutions Consultant"],
    "PE": ["Software Engineer"],
    "PTA": ["Principal Technology Architect"],
    "Platform Eng": ["Software Engineer"],
    "Principal": ["Principal"],
    "SAC (UK)": ["Senior Associate Consultant"],
    "SAC or Exp AC": ["Senior Associate Consultant", "Associate Consultant"],
    "SC (UK)": ["Solutions Consultant", "Senior Consultant"],
    "SC/C": ["Solutions Consultant", "Consultant"],
    "SE (Platform Engineer)": ["Software Engineer"],
    "SSC": ["Senior Solutions Consultant"],
    "SSE - Replacement": ["Senior Software Engineer"],
    "SSE or Exp SE": ["Senior Software Engineer", "Software Engineer"],
    "SSE/SE": ["Senior Software Engineer", "Software Engineer"],
    "Sol C": ["Solutions Consultant", "Senior Consultant"],
    "Sol Enabler": ["Solutions Enabler"],
    "Tech Arch": ["Technical Solutions Architect", "Technology Solutions Architect"],
}

def decode_resource_code(code) -> list[str]:
    if not isinstance(code, str):
        return []
    return list(RESOURCE_CODE_MAP.get(code.strip(), []))

def group_label(code) -> str:
    designations = decode_resource_code(code)
    if not designations:
        return f"{code} (no resolvable designation)"
    return " or ".join(designations)
