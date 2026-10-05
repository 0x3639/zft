/** Public actions resume after wallet/profile setup; file actions wait for backup. */
export async function canResumeOnboarding(
  destination: string,
  state: { profile?: string; unlocked: boolean; backedUp: boolean },
  readProfile: (address: string) => Promise<unknown>,
): Promise<boolean> {
  const path = destination.split(/[?#]/, 1)[0];
  const publicReturn =
    path === "/" ||
    path === "/explore" ||
    path.startsWith("/explore/") ||
    path.startsWith("/p/") ||
    path === "/activity";
  if (!publicReturn) return state.unlocked && state.backedUp;
  if (!state.profile) return false;
  try {
    await readProfile(state.profile);
    return true;
  } catch {
    // New identities finish saving their profile; failed lookups remain here.
    return false;
  }
}
