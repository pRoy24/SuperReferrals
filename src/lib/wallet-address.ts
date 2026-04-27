export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isValidEvmAddress(value?: string | null) {
  return /^0x[0-9a-fA-F]{40}$/.test(cleanWalletAddress(value));
}

export function isZeroAddress(value?: string | null) {
  return cleanWalletAddress(value).toLowerCase() === ZERO_ADDRESS;
}

export function isUsableEvmAddress(value?: string | null) {
  return isValidEvmAddress(value) && !isZeroAddress(value);
}

export function assertUsableEvmAddress(value: string | undefined | null, label: string) {
  const address = cleanWalletAddress(value);
  if (!isUsableEvmAddress(address)) {
    throw new Error(`${label} must be a valid non-zero EVM address.`);
  }
  return address as `0x${string}`;
}

function cleanWalletAddress(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}
