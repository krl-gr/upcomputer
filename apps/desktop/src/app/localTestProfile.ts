// A packaged, opt-in local QA identity. Never share Alpha's state or updater.
export const LOCAL_TEST_APP_NAME = "UpComputer Local Test";
export const LOCAL_TEST_APP_ID = "computer.up.upcomputer.localtest";
export const LOCAL_TEST_HOME_NAME = ".upcomputer-local-test";

export function isLocalTestVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-localtest\.\d+$/.test(version);
}
