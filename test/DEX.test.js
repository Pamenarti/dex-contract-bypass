const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
    let DEX, dex;
    let TestToken, token0, token1;
    let owner, user1, user2;
    
    const INITIAL_SUPPLY = ethers.utils.parseEther("1000000");
    const LIQUIDITY_AMOUNT = ethers.utils.parseEther("1000");
    const SWAP_AMOUNT = ethers.utils.parseEther("100");
    
    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy test tokens
        TestToken = await ethers.getContractFactory("TestToken");
        token0 = await TestToken.deploy("Token0", "TK0");
        token1 = await TestToken.deploy("Token1", "TK1");
        await Promise.all([token0.deployed(), token1.deployed()]);
        
        // Deploy DEX
        DEX = await ethers.getContractFactory("DEX");
        dex = await DEX.deploy();
        await dex.deployed();
        
        // Mint tokens to users
        await token0.mint(user1.address, INITIAL_SUPPLY);
        await token1.mint(user1.address, INITIAL_SUPPLY);
        await token0.mint(user2.address, INITIAL_SUPPLY);
        await token1.mint(user2.address, INITIAL_SUPPLY);
    });
    
    describe("Pool Creation", function () {
        it("Should create pool correctly", async function () {
            const tx = await dex.createPool(token0.address, token1.address);
            const receipt = await tx.wait();
            
            const poolCreatedEvent = receipt.events.find(
                e => e.event === "PoolCreated"
            );
            
            expect(poolCreatedEvent.args.token0).to.equal(token0.address);
            expect(poolCreatedEvent.args.token1).to.equal(token1.address);
        });
        
        it("Should fail for same tokens", async function () {
            await expect(
                dex.createPool(token0.address, token0.address)
            ).to.be.revertedWith("Same tokens");
        });
    });
    
    describe("Liquidity", function () {
        let poolId;
        
        beforeEach(async function () {
            const tx = await dex.createPool(token0.address, token1.address);
            const receipt = await tx.wait();
            poolId = receipt.events.find(e => e.event === "PoolCreated").args.poolId;
        });
        
        it("Should add initial liquidity correctly", async function () {
            await token0.connect(user1).approve(dex.address, LIQUIDITY_AMOUNT);
            await token1.connect(user1).approve(dex.address, LIQUIDITY_AMOUNT);
            
            await expect(
                dex.connect(user1).addLiquidity(
                    poolId,
                    LIQUIDITY_AMOUNT,
                    LIQUIDITY_AMOUNT
                )
            ).to.emit(dex, "LiquidityAdded");
            
            const pool = await dex.pools(poolId);
            expect(pool.reserve0).to.equal(LIQUIDITY_AMOUNT);
            expect(pool.reserve1).to.equal(LIQUIDITY_AMOUNT);
        });
        
        it("Should remove liquidity correctly", async function () {
            // Add liquidity first
            await token0.connect(user1).approve(dex.address, LIQUIDITY_AMOUNT);
            await token1.connect(user1).approve(dex.address, LIQUIDITY_AMOUNT);
            await dex.connect(user1).addLiquidity(
                poolId,
                LIQUIDITY_AMOUNT,
                LIQUIDITY_AMOUNT
            );
            
            const shares = await dex.lpTokens(poolId, user1.address);
            await expect(
                dex.connect(user1).removeLiquidity(poolId, shares)
            ).to.emit(dex, "LiquidityRemoved");
            
            const pool = await dex.pools(poolId);
            expect(pool.reserve0).to.equal(0);
            expect(pool.reserve1).to.equal(0);
        });
    });
    
    describe("Swapping", function () {
        let poolId;
        
        beforeEach(async function () {
            const tx = await dex.createPool(token0.address, token1.address);
            const receipt = await tx.wait();
            poolId = receipt.events.find(e => e.event === "PoolCreated").args.poolId;
            
            // Add initial liquidity
            await token0.connect(user1).approve(dex.address, LIQUIDITY_AMOUNT);
            await token1.connect(user1).approve(dex.address, LIQUIDITY_AMOUNT);
            await dex.connect(user1).addLiquidity(
                poolId,
                LIQUIDITY_AMOUNT,
                LIQUIDITY_AMOUNT
            );
        });
        
        it("Should swap tokens correctly", async function () {
            await token0.connect(user2).approve(dex.address, SWAP_AMOUNT);
            
            const balanceBefore = await token1.balanceOf(user2.address);
            
            await expect(
                dex.connect(user2).swap(poolId, token0.address, SWAP_AMOUNT)
            ).to.emit(dex, "Swap");
            
            const balanceAfter = await token1.balanceOf(user2.address);
            expect(balanceAfter).to.be.gt(balanceBefore);
        });
        
        it("Should calculate swap amounts correctly", async function () {
            const amountOut = await dex.getAmountOut(
                SWAP_AMOUNT,
                LIQUIDITY_AMOUNT,
                LIQUIDITY_AMOUNT
            );
            
            expect(amountOut).to.be.lt(SWAP_AMOUNT);
        });
    });
}); 