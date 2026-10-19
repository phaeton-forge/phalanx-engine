/** Section version shared by the engine save sections. Not a public export. */
export const ENGINE_SECTION_VERSION = 1;

export function assertSectionVersion(helper: string, version: number): void {
  if (version !== ENGINE_SECTION_VERSION) {
    throw new Error(
      `${helper}: unsupported section version ${String(version)}`
    );
  }
}
