declare const TextEncoder: {
  new (): { encode(input?: string): Uint8Array };
};

declare const TextDecoder: {
  new (
    label?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean }
  ): { decode(input: Uint8Array): string };
};
