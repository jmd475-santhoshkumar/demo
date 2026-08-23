declare module "mammoth" {
  export interface ConvertResult {
    value: string;
    messages: unknown[];
  }
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertResult>;
}
