// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract DEX is ReentrancyGuard, Ownable {
    using SafeMath for uint256;

    struct Pool {
        IERC20 token0;
        IERC20 token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalShares;
        uint256 kLast;
        bool isActive;
    }

    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => mapping(address => uint256)) public lpTokens;
    
    uint256 public constant PRECISION = 1e18;
    uint256 public feePercent = 30; // 0.3%
    uint256 public protocolFeeShare = 1667; // 1/6th of the fee (0.05%)
    
    event PoolCreated(address token0, address token1, bytes32 poolId);
    event LiquidityAdded(
        bytes32 poolId,
        address provider,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event LiquidityRemoved(
        bytes32 poolId,
        address provider,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event Swap(
        bytes32 poolId,
        address trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor() {}

    function createPool(address _token0, address _token1) external returns (bytes32) {
        require(_token0 != _token1, "Same tokens");
        
        bytes32 poolId = keccak256(abi.encodePacked(_token0, _token1));
        require(!pools[poolId].isActive, "Pool exists");
        
        pools[poolId] = Pool({
            token0: IERC20(_token0),
            token1: IERC20(_token1),
            reserve0: 0,
            reserve1: 0,
            totalShares: 0,
            kLast: 0,
            isActive: true
        });
        
        emit PoolCreated(_token0, _token1, poolId);
        return poolId;
    }

    function addLiquidity(
        bytes32 _poolId,
        uint256 _amount0,
        uint256 _amount1
    ) external nonReentrant returns (uint256) {
        Pool storage pool = pools[_poolId];
        require(pool.isActive, "Pool not active");
        
        uint256 shares;
        if (pool.totalShares == 0) {
            shares = _sqrt(_amount0.mul(_amount1));
        } else {
            uint256 share0 = _amount0.mul(pool.totalShares).div(pool.reserve0);
            uint256 share1 = _amount1.mul(pool.totalShares).div(pool.reserve1);
            shares = share0 < share1 ? share0 : share1;
        }
        
        require(shares > 0, "No shares to mint");
        
        pool.token0.transferFrom(msg.sender, address(this), _amount0);
        pool.token1.transferFrom(msg.sender, address(this), _amount1);
        
        pool.reserve0 = pool.reserve0.add(_amount0);
        pool.reserve1 = pool.reserve1.add(_amount1);
        pool.totalShares = pool.totalShares.add(shares);
        lpTokens[_poolId][msg.sender] = lpTokens[_poolId][msg.sender].add(shares);
        
        pool.kLast = pool.reserve0.mul(pool.reserve1);
        
        emit LiquidityAdded(_poolId, msg.sender, _amount0, _amount1, shares);
        return shares;
    }

    function removeLiquidity(bytes32 _poolId, uint256 _shares)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        Pool storage pool = pools[_poolId];
        require(pool.isActive, "Pool not active");
        require(_shares > 0, "No shares");
        require(lpTokens[_poolId][msg.sender] >= _shares, "Insufficient shares");
        
        amount0 = _shares.mul(pool.reserve0).div(pool.totalShares);
        amount1 = _shares.mul(pool.reserve1).div(pool.totalShares);
        
        lpTokens[_poolId][msg.sender] = lpTokens[_poolId][msg.sender].sub(_shares);
        pool.totalShares = pool.totalShares.sub(_shares);
        pool.reserve0 = pool.reserve0.sub(amount0);
        pool.reserve1 = pool.reserve1.sub(amount1);
        
        pool.token0.transfer(msg.sender, amount0);
        pool.token1.transfer(msg.sender, amount1);
        
        pool.kLast = pool.reserve0.mul(pool.reserve1);
        
        emit LiquidityRemoved(_poolId, msg.sender, amount0, amount1, _shares);
    }

    function swap(
        bytes32 _poolId,
        address _tokenIn,
        uint256 _amountIn
    ) external nonReentrant returns (uint256) {
        Pool storage pool = pools[_poolId];
        require(pool.isActive, "Pool not active");
        require(
            _tokenIn == address(pool.token0) || _tokenIn == address(pool.token1),
            "Invalid token"
        );
        
        bool isToken0 = _tokenIn == address(pool.token0);
        (IERC20 tokenIn, IERC20 tokenOut, uint256 reserveIn, uint256 reserveOut) = isToken0
            ? (pool.token0, pool.token1, pool.reserve0, pool.reserve1)
            : (pool.token1, pool.token0, pool.reserve1, pool.reserve0);
        
        uint256 amountInWithFee = _amountIn.mul(uint256(1000).sub(feePercent)).div(1000);
        uint256 amountOut = getAmountOut(amountInWithFee, reserveIn, reserveOut);
        
        tokenIn.transferFrom(msg.sender, address(this), _amountIn);
        tokenOut.transfer(msg.sender, amountOut);
        
        _updateReserves(
            pool,
            isToken0 ? reserveIn.add(_amountIn) : reserveOut.sub(amountOut),
            isToken0 ? reserveOut.sub(amountOut) : reserveIn.add(_amountIn)
        );
        
        emit Swap(
            _poolId,
            msg.sender,
            address(tokenIn),
            address(tokenOut),
            _amountIn,
            amountOut
        );
        
        return amountOut;
    }

    function getAmountOut(
        uint256 _amountIn,
        uint256 _reserveIn,
        uint256 _reserveOut
    ) public pure returns (uint256) {
        require(_amountIn > 0, "Invalid input amount");
        require(_reserveIn > 0 && _reserveOut > 0, "Invalid reserves");
        
        uint256 numerator = _amountIn.mul(_reserveOut);
        uint256 denominator = _reserveIn.add(_amountIn);
        
        return numerator.div(denominator);
    }

    function _updateReserves(
        Pool storage _pool,
        uint256 _reserve0,
        uint256 _reserve1
    ) private {
        _pool.reserve0 = _reserve0;
        _pool.reserve1 = _reserve1;
        _pool.kLast = _reserve0.mul(_reserve1);
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function setFeePercent(uint256 _feePercent) external onlyOwner {
        require(_feePercent <= 100, "Fee too high"); // Max 1%
        feePercent = _feePercent;
    }

    function setProtocolFeeShare(uint256 _share) external onlyOwner {
        require(_share <= 5000, "Share too high"); // Max 50%
        protocolFeeShare = _share;
    }
} 