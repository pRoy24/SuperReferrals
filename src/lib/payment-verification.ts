import { createPublicClient, getAddress, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { getTransactionChainConfig, NATIVE_TOKEN_ADDRESS } from "./payment-tokens";

export interface RenderPaymentVerificationInput {
  txHash: string;
  chainId: number;
  payerWallet?: string;
  recipientWallet: string;
  tokenAddress: string;
  amountAtomic: string;
}

export interface RenderPaymentVerification {
  txHash: string;
  chainId: number;
  blockNumber: string;
  tokenAddress: string;
  recipientWallet: string;
  amountAtomic: string;
}

export async function verifyRenderPaymentTransaction(
  input: RenderPaymentVerificationInput
): Promise<RenderPaymentVerification> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
    throw new Error("payment tx hash must be a valid transaction hash");
  }
  const client = createPublicClient({
    chain: input.chainId === 1 ? mainnet : input.chainId === 11155111 ? sepolia : undefined,
    transport: http(getTransactionChainConfig(input.chainId).rpcUrls[0])
  });
  const hash = input.txHash as `0x${string}`;
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash })
  ]).catch(() => {
    throw new Error("payment transaction is not mined or was not found on the expected chain");
  });

  if (receipt.status !== "success") {
    throw new Error("payment transaction was not successful");
  }
  if (transaction.chainId && transaction.chainId !== input.chainId) {
    throw new Error(`payment transaction is on chain ${transaction.chainId}, expected ${input.chainId}`);
  }
  if (input.payerWallet && !sameAddress(transaction.from, input.payerWallet)) {
    throw new Error("payment transaction sender does not match the render wallet");
  }

  const expectedAmount = BigInt(input.amountAtomic || "0");
  if (expectedAmount <= 0n) {
    throw new Error("payment amount must be greater than zero");
  }

  if (isNativeToken(input.tokenAddress)) {
    if (!transaction.to || !sameAddress(transaction.to, input.recipientWallet)) {
      throw new Error("native payment transaction recipient does not match the customer wallet");
    }
    if (transaction.value < expectedAmount) {
      throw new Error("native payment transaction amount is lower than the render quote");
    }
  } else {
    assertErc20Transfer({
      txTo: transaction.to,
      txInput: String(transaction.input || ""),
      tokenAddress: input.tokenAddress,
      recipientWallet: input.recipientWallet,
      amountAtomic: expectedAmount
    });
  }

  return {
    txHash: input.txHash,
    chainId: input.chainId,
    blockNumber: String(receipt.blockNumber),
    tokenAddress: normalizedAddress(input.tokenAddress),
    recipientWallet: normalizedAddress(input.recipientWallet),
    amountAtomic: input.amountAtomic
  };
}

function assertErc20Transfer({
  txTo,
  txInput,
  tokenAddress,
  recipientWallet,
  amountAtomic
}: {
  txTo?: string | null;
  txInput: string;
  tokenAddress: string;
  recipientWallet: string;
  amountAtomic: bigint;
}) {
  if (!txTo || !sameAddress(txTo, tokenAddress)) {
    throw new Error("ERC20 payment transaction token does not match the render quote");
  }
  const data = txInput.toLowerCase();
  if (!data.startsWith("0xa9059cbb") || data.length < 138) {
    throw new Error("ERC20 payment transaction is not a transfer call");
  }
  const recipientWord = data.slice(10, 74);
  const amountWord = data.slice(74, 138);
  const recipient = `0x${recipientWord.slice(24)}`;
  const amount = BigInt(`0x${amountWord}`);
  if (!sameAddress(recipient, recipientWallet)) {
    throw new Error("ERC20 payment transaction recipient does not match the customer wallet");
  }
  if (amount < amountAtomic) {
    throw new Error("ERC20 payment transaction amount is lower than the render quote");
  }
}

function isNativeToken(tokenAddress: string) {
  return tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS;
}

function sameAddress(left: string, right: string) {
  return normalizedAddress(left) === normalizedAddress(right);
}

function normalizedAddress(address: string) {
  return getAddress(address);
}
