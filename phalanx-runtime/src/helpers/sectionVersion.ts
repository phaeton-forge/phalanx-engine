/** Section version shared by every Task 4 state helper. */
export const HELPER_SECTION_VERSION = 1;

export function assertSectionVersion(helper: string, version: number): void {
  if (version !== HELPER_SECTION_VERSION) {
    throw new Error(
      `${helper}: unsupported section version ${String(version)}`
    );
  }
}
