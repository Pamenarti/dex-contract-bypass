const ethers = require('ethers');
const Web3 = require('web3');
const dotenv = require('dotenv');
const dexABI = require('./artifacts/contracts/DEX.sol/DEX.json').abi;

class DEXService {
    constructor() {
        dotenv.config();
        this.provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.contractAddress = process.env.DEX_ADDRESS;
    }

    async initializeContract() {
        this.contract = new ethers.Contract(
            this.contractAddress,
            dexABI,
            this.provider
        );
        this.contractWithSigner = this.contract.connect(this.wallet);
    }

    async createPool(token0Address, token1Address) {
        const tx = await this.contractWithSigner.createPool(
            token0Address,
            token1Address
        );
        return await tx.wait();
    }

    async addLiquidity(poolId, amount0, amount1) {
        const pool = await this.contract.pools(poolId);
        
        // Approve tokens
        const token0 = new ethers.Contract(
            pool.token0,
            ['function approve(address spender, uint256 amount) external returns (bool)'],
            this.wallet
        );
        const token1 = new ethers.Contract(
            pool.token1,
            ['function approve(address spender, uint256 amount) external returns (bool)'],
            this.wallet
        );

        await token0.approve(this.contractAddress, amount0);
        await token1.approve(this.contractAddress, amount1);

        const tx = await this.contractWithSigner.addLiquidity(
            poolId,
            amount0,
            amount1
        );
        return await tx.wait();
    }

    async removeLiquidity(poolId, shares) {
        const tx = await this.contractWithSigner.removeLiquidity(poolId, shares);
        return await tx.wait();
    }

    async swap(poolId, tokenIn, amountIn) {
        const token = new ethers.Contract(
            tokenIn,
            ['function approve(address spender, uint256 amount) external returns (bool)'],
            this.wallet
        );

        await token.approve(this.contractAddress, amountIn);
        const tx = await this.contractWithSigner.swap(poolId, tokenIn, amountIn);
        return await tx.wait();
    }

    async getPoolInfo(poolId) {
        const pool = await this.contract.pools(poolId);
        return {
            token0: pool.token0,
            token1: pool.token1,
            reserve0: ethers.utils.formatEther(pool.reserve0),
            reserve1: ethers.utils.formatEther(pool.reserve1),
            totalShares: ethers.utils.formatEther(pool.totalShares),
            isActive: pool.isActive
        };
    }

    async getLPTokenBalance(poolId, address) {
        const balance = await this.contract.lpTokens(poolId, address);
        return ethers.utils.formatEther(balance);
    }

    async getAmountOut(amountIn, reserveIn, reserveOut) {
        return await this.contract.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    async listenToEvents() {
        this.contract.on("PoolCreated", (token0, token1, poolId, event) => {
            console.log(`
                New Pool Created:
                Token0: ${token0}
                Token1: ${token1}
                Pool ID: ${poolId}
            `);
        });

        this.contract.on("LiquidityAdded",
            (poolId, provider, amount0, amount1, shares, event) => {
                console.log(`
                    Liquidity Added:
                    Pool ID: ${poolId}
                    Provider: ${provider}
                    Amount0: ${ethers.utils.formatEther(amount0)}
                    Amount1: ${ethers.utils.formatEther(amount1)}
                    Shares: ${ethers.utils.formatEther(shares)}
                `);
            }
        );

        this.contract.on("Swap",
            (poolId, trader, tokenIn, tokenOut, amountIn, amountOut, event) => {
                console.log(`
                    Swap Executed:
                    Pool ID: ${poolId}
                    Trader: ${trader}
                    Token In: ${tokenIn}
                    Token Out: ${tokenOut}
                    Amount In: ${ethers.utils.formatEther(amountIn)}
                    Amount Out: ${ethers.utils.formatEther(amountOut)}
                `);
            }
        );
    }
}

module.exports = DEXService; 