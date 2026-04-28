const deployerAccounts = process.env.OG_PRIVATE_KEY ? [process.env.OG_PRIVATE_KEY] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    ogTestnet: {
      url: process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai",
      chainId: Number(process.env.OG_CHAIN_ID || 16602),
      accounts: deployerAccounts
    },
    ogMainnet: {
      url: process.env.OG_MAINNET_RPC_URL || "https://evmrpc.0g.ai",
      chainId: 16661,
      accounts: deployerAccounts
    },
    sepolia: {
      url: process.env.TRANSACTION_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: deployerAccounts
    },
    mainnet: {
      url: process.env.TRANSACTION_RPC_URL || "https://eth.llamarpc.com",
      chainId: 1,
      accounts: deployerAccounts
    }
  }
};
