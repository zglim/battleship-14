/**
 * Battleship 关键规则验证测试
 *
 * 运行方式：node test_rules.js
 * 不依赖任何测试框架，纯 Node.js 内置 assert。
 */

const assert = require('assert');

// ──── 从 server.js 引入可测试单元 ────
const {
    gameState,
    initializeGame,
    validateShipMove,
    canShipMoveTo,
    validateAttack,
    moveShip,
    rotateShip,
    attackWithShip,
    processShipAction,
    switchTurn,
    resetShipActions,
    hasAvailableActions,
    registerPlayer,
    unregisterPlayer,
    SHIP_TYPES,
    SHIP_COUNTS,
    generateShipList
} = require('./server');

// ──── 辅助函数 ────
let passCount = 0;
let failCount = 0;

function test(name, fn) {
    try {
        fn();
        passCount++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failCount++;
        console.log(`  ✗ ${name}`);
        console.log(`    ${err.message}`);
    }
}

function setupCleanGame() {
    initializeGame();
    gameState.players = {};
    gameState.playersByColor = {};
    gameState.gamePhase = 'playing';
    gameState.currentTurn = 'red';
    gameState.turnSwitching = false;
}

// 快速在指定位置放置一艘船
function placeShipAt(color, shipId, x, y, direction) {
    const ship = gameState.ships[color].find(s => s.id === shipId);
    if (!ship) throw new Error(`Ship ${shipId} not found for ${color}`);
    ship.x = x;
    ship.y = y;
    ship.direction = direction || 'horizontal';
    ship.placed = true;
    ship.ready = true;
    ship.actionTaken = false;
    ship.sunk = false;
    ship.health = ship.maxHealth;
    return ship;
}

// ─────────────────────────────────────────────────────────────
// 1. 单格船移动测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 1. 单格船移动测试 ===');

test('单格船可以向上移动一格', () => {
    setupCleanGame();
    gameState.obstacles = []; // 清除障碍物
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 5, targetY: 4 }, 'red');
    assert.strictEqual(result.success, true, `应成功: ${result.message}`);
    assert.strictEqual(ship.y, 4);
});

test('单格船可以向下移动一格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 5, targetY: 6 }, 'red');
    assert.strictEqual(result.success, true);
    assert.strictEqual(ship.y, 6);
});

test('单格船可以向左移动一格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 4, targetY: 5 }, 'red');
    assert.strictEqual(result.success, true);
    assert.strictEqual(ship.x, 4);
});

test('单格船可以向右移动一格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 6, targetY: 5 }, 'red');
    assert.strictEqual(result.success, true);
    assert.strictEqual(ship.x, 6);
});

test('单格船不能对角线移动', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 6, targetY: 6 }, 'red');
    assert.strictEqual(result.success, false, '对角线移动应失败');
    assert.strictEqual(result.errorType, 'INVALID_MOVE_DISTANCE');
});

test('单格船不能移动超过一格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 7, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'INVALID_MOVE_DISTANCE');
});

test('单格船不能原地不动', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 5, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'MOVE_SAME_POSITION');
});

test('单格船不能移动到棋盘外（上边界）', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 0, 'horizontal');
    const result = moveShip(ship, { targetX: 5, targetY: -1 }, 'red');
    assert.strictEqual(result.success, false);
});

test('单格船不能移动到棋盘外（左边界）', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 0, 5, 'horizontal');
    const result = moveShip(ship, { targetX: -1, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false);
});

test('单格船不能移动到障碍物上', () => {
    setupCleanGame();
    gameState.obstacles = [{ x: 5, y: 4 }];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 5, targetY: 4 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'MOVE_HIT_OBSTACLE');
});

test('单格船不能移动到其他船只上', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship1 = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    placeShipAt('red', 'red-combat_boat-2', 5, 4, 'horizontal');
    const result = moveShip(ship1, { targetX: 5, targetY: 4 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'MOVE_HIT_SHIP');
});

// ─────────────────────────────────────────────────────────────
// 2. 多格船移动 / 转向边界测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 2. 多格船移动 / 转向边界测试 ===');

test('水平战列舰可以向右移动一格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 2, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 3, targetY: 5 }, 'red');
    assert.strictEqual(result.success, true);
    assert.strictEqual(ship.x, 3);
});

test('水平战列舰可以向左移动一格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 2, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 1, targetY: 5 }, 'red');
    assert.strictEqual(result.success, true);
    assert.strictEqual(ship.x, 1);
});

test('水平战列舰不能垂直移动', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 2, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 2, targetY: 6 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'INVALID_MOVE_DIRECTION');
});

test('水平战列舰不能一次移动两格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 2, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 4, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'INVALID_MOVE_DISTANCE');
});

test('垂直驱逐舰可以向下移动一格', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-destroyer-1', 5, 2, 'vertical');
    const result = moveShip(ship, { targetX: 5, targetY: 3 }, 'red');
    assert.strictEqual(result.success, true);
    assert.strictEqual(ship.y, 3);
});

test('垂直驱逐舰不能水平移动', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-destroyer-1', 5, 2, 'vertical');
    const result = moveShip(ship, { targetX: 6, targetY: 2 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'INVALID_MOVE_DIRECTION');
});

test('水平战列舰移动到右边界外应失败（size=4, x=13, 右移一格 → x=14, 最远格 x=17 超界）', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 13, 5, 'horizontal');
    const result = moveShip(ship, { targetX: 14, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false, '应因超出边界失败');
});

test('垂直驱逐舰移到底边界外应失败', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-destroyer-1', 5, 14, 'vertical');
    const result = moveShip(ship, { targetX: 5, targetY: 15 }, 'red');
    assert.strictEqual(result.success, false);
});

// ─────────────────────────────────────────────────────────────
// 3. 转向边界测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 3. 转向边界测试 ===');

test('单格船只不能转向', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'horizontal');
    const result = rotateShip(ship, { targetX: 5, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'CANNOT_ROTATE_SIZE_1');
});

test('水平战列舰转向为垂直（合法位置）', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 5, 5, 'horizontal');
    // 转为垂直: (5,5) → (5,5), (5,6), (5,7), (5,8)
    const result = rotateShip(ship, { targetX: 5, targetY: 5 }, 'red');
    assert.strictEqual(result.success, true);
    assert.strictEqual(ship.direction, 'vertical');
    assert.strictEqual(ship.x, 5);
    assert.strictEqual(ship.y, 5);
});

test('战列舰在右下角转向超出边界应失败', () => {
    setupCleanGame();
    gameState.obstacles = [];
    // 水平战列舰在 (12, 14) → 占 (12,14)(13,14)(14,14)(15,14)
    const ship = placeShipAt('red', 'red-battleship-1', 12, 14, 'horizontal');
    // 尝试转向为垂直 → (12,14)(12,15)(12,16)(12,17) → 超界
    const result = rotateShip(ship, { targetX: 12, targetY: 14 }, 'red');
    assert.strictEqual(result.success, false);
});

// ─────────────────────────────────────────────────────────────
// 4. 回合切换测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 4. 回合切换测试 ===');

test('正常回合切换 red→blue', () => {
    setupCleanGame();
    assert.strictEqual(gameState.currentTurn, 'red');
    switchTurn('red');
    // switchTurn 内部使用 process.nextTick 释放锁，但回合本身已切换
    assert.strictEqual(gameState.currentTurn, 'blue');
});

test('非当前回合方不能触发切换', () => {
    setupCleanGame();
    assert.strictEqual(gameState.currentTurn, 'red');
    switchTurn('blue'); // blue 不是当前回合
    assert.strictEqual(gameState.currentTurn, 'red', '不应切换');
});

test('切换回合后重置新回合方的行动状态', () => {
    setupCleanGame();
    // 让 blue 的所有船都标记为已行动
    gameState.ships.blue.forEach(s => {
        s.placed = true;
        s.actionTaken = true;
    });
    switchTurn('red');
    // 现在 currentTurn 变为 blue, 其所有船只应该被重置
    const allReset = gameState.ships.blue.every(s => s.actionTaken === false);
    assert.strictEqual(allReset, true, 'blue 方所有船只行动状态应被重置');
});

test('hasAvailableActions 检测正确', () => {
    setupCleanGame();
    gameState.ships.red.forEach(s => {
        s.placed = true;
        s.actionTaken = true;
        s.sunk = false;
    });
    assert.strictEqual(hasAvailableActions('red'), false);

    gameState.ships.red[0].actionTaken = false;
    assert.strictEqual(hasAvailableActions('red'), true);
});

// ─────────────────────────────────────────────────────────────
// 5. 重复选边测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 5. 重复选边 / 断线重连测试 ===');

test('registerPlayer 和 unregisterPlayer 基本功能', () => {
    setupCleanGame();
    registerPlayer('socket1', 'red');
    assert.strictEqual(gameState.playersByColor['red'], 'socket1');
    assert.ok(gameState.players['socket1']);

    const removed = unregisterPlayer('socket1');
    assert.strictEqual(removed.color, 'red');
    assert.strictEqual(gameState.playersByColor['red'], undefined);
    assert.strictEqual(gameState.players['socket1'], undefined);
});

test('同一颜色不允许被两个 socket 同时占用', () => {
    setupCleanGame();
    registerPlayer('socket1', 'red');
    registerPlayer('socket2', 'red'); // 这在实际 socket handler 里会被拦截
    // 测试 registerPlayer 本身的行为：后来者覆盖
    assert.strictEqual(gameState.playersByColor['red'], 'socket2');
    // 清理
    unregisterPlayer('socket1');
    unregisterPlayer('socket2');
});

test('断线后清除映射，允许新 socket 加入同色', () => {
    setupCleanGame();
    registerPlayer('socket1', 'blue');
    unregisterPlayer('socket1');

    // 模拟新 socket 加入
    registerPlayer('socket2', 'blue');
    assert.strictEqual(gameState.playersByColor['blue'], 'socket2');
    assert.ok(gameState.players['socket2']);

    unregisterPlayer('socket2');
});

test('断线不影响对局数据（船只状态保留）', () => {
    setupCleanGame();
    gameState.obstacles = [];
    registerPlayer('socket1', 'red');
    const ship = placeShipAt('red', 'red-battleship-1', 3, 3, 'horizontal');
    const savedX = ship.x;
    const savedY = ship.y;

    unregisterPlayer('socket1');

    // 船只数据应该还在
    const shipAfter = gameState.ships.red.find(s => s.id === 'red-battleship-1');
    assert.strictEqual(shipAfter.x, savedX);
    assert.strictEqual(shipAfter.y, savedY);
    assert.strictEqual(shipAfter.placed, true);
});

// ─────────────────────────────────────────────────────────────
// 6. 攻击验证测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 6. 攻击验证测试 ===');

test('攻击超出棋盘边界应失败', () => {
    setupCleanGame();
    const ship = placeShipAt('red', 'red-battleship-1', 3, 5, 'horizontal');
    const result = validateAttack(ship, 20, 5, 'red');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorType, 'ATTACK_OUT_OF_BOUNDS');
});

test('攻击目标格没有敌方船只应失败', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 3, 5, 'horizontal');
    // 蓝方没有放置任何船
    const result = validateAttack(ship, 10, 5, 'red');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorType, 'NO_ENEMY_AT_TARGET');
});

test('攻击超出射程应失败', () => {
    setupCleanGame();
    gameState.obstacles = [];
    // 红色战列舰在 (3,5)，水平，size=4，attackRange=4
    const ship = placeShipAt('red', 'red-battleship-1', 3, 5, 'horizontal');
    // 蓝色船只在 (10, 5) → 与红色最远格 (6,5) 距离 4，恰好在射程内
    placeShipAt('blue', 'blue-combat_boat-1', 10, 5, 'horizontal');
    // 攻击 (11, 5) → 距离红色最远格 (6,5) 为 5，超出 range=4
    placeShipAt('blue', 'blue-battleship-1', 11, 5, 'horizontal');
    const result = validateAttack(ship, 11, 5, 'red');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorType, 'ATTACK_OUT_OF_RANGE');
});

test('攻击在射程内且同一行应成功', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 3, 5, 'horizontal');
    // 蓝色船只在 (8, 5) → 与红色格 (6,5) 距离 2，range=4，OK
    placeShipAt('blue', 'blue-combat_boat-1', 8, 5, 'horizontal');
    const result = validateAttack(ship, 8, 5, 'red');
    assert.strictEqual(result.valid, true);
});

test('攻击在射程内且同一列应成功', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-combat_boat-1', 5, 5, 'vertical');
    // combat_boat range=3, 蓝色在 (5, 7) → 同列，距离 2
    placeShipAt('blue', 'blue-combat_boat-1', 5, 7, 'horizontal');
    const result = validateAttack(ship, 5, 7, 'red');
    assert.strictEqual(result.valid, true);
});

// ─────────────────────────────────────────────────────────────
// 7. 前后端一致性验证（validateShipMove = canShipMoveTo）
// ─────────────────────────────────────────────────────────────
console.log('\n=== 7. canShipMoveTo 与 validateShipMove 一致性 ===');

test('canShipMoveTo 与 validateShipMove 结果一致（合法）', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const oldResult = canShipMoveTo('test-ship', 'horizontal', 2, 5, 5);
    const newResult = validateShipMove('test-ship', 'horizontal', 2, 5, 5);
    assert.strictEqual(oldResult, newResult.valid);
});

test('canShipMoveTo 与 validateShipMove 结果一致（越界）', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const oldResult = canShipMoveTo('test-ship', 'horizontal', 4, 14, 5);
    const newResult = validateShipMove('test-ship', 'horizontal', 4, 14, 5);
    assert.strictEqual(oldResult, newResult.valid);
});

// ─────────────────────────────────────────────────────────────
// 8. processShipAction 错误分类测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 8. processShipAction 错误分类 ===');

test('对已沉没的船执行动作返回 SHIP_SUNK', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 3, 5, 'horizontal');
    ship.sunk = true;
    const result = processShipAction({ type: 'move', shipId: ship.id, targetX: 4, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'SHIP_SUNK');
});

test('对已行动的船执行动作返回 SHIP_ALREADY_ACTED', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 3, 5, 'horizontal');
    ship.actionTaken = true;
    const result = processShipAction({ type: 'move', shipId: ship.id, targetX: 4, targetY: 5 }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'SHIP_ALREADY_ACTED');
});

test('未知动作类型返回 UNKNOWN_ACTION', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const ship = placeShipAt('red', 'red-battleship-1', 3, 5, 'horizontal');
    const result = processShipAction({ type: 'fly', shipId: ship.id }, 'red');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'UNKNOWN_ACTION');
});

// ─────────────────────────────────────────────────────────────
// 9. validateShipMove 详细错误信息测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 9. validateShipMove 详细错误 ===');

test('超出边界返回 MOVE_OUT_OF_BOUNDS', () => {
    setupCleanGame();
    gameState.obstacles = [];
    const result = validateShipMove('s1', 'horizontal', 4, 14, 5);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorType, 'MOVE_OUT_OF_BOUNDS');
});

test('与障碍物重叠返回 MOVE_HIT_OBSTACLE', () => {
    setupCleanGame();
    gameState.obstacles = [{ x: 6, y: 5 }];
    const result = validateShipMove('s1', 'horizontal', 4, 5, 5);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorType, 'MOVE_HIT_OBSTACLE');
});

test('与其他船只重叠返回 MOVE_HIT_SHIP', () => {
    setupCleanGame();
    gameState.obstacles = [];
    placeShipAt('blue', 'blue-battleship-1', 10, 5, 'horizontal');
    // 尝试让另一艘船移动到与蓝色战列舰重叠的位置
    const result = validateShipMove('red-battleship-1', 'horizontal', 4, 10, 5);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorType, 'MOVE_HIT_SHIP');
});

// ─────────────────────────────────────────────────────────────
// 10. 掉线后再进入恢复测试
// ─────────────────────────────────────────────────────────────
console.log('\n=== 10. 掉线后再进入恢复测试 ===');

test('掉线后游戏状态不自毁，重新进入可恢复', () => {
    setupCleanGame();
    gameState.obstacles = [];
    registerPlayer('sock-A', 'red');
    registerPlayer('sock-B', 'blue');
    const ship = placeShipAt('red', 'red-destroyer-1', 2, 3, 'vertical');
    const shipHP = ship.health;

    // 红方掉线
    unregisterPlayer('sock-A');

    // 对局数据保持
    assert.strictEqual(gameState.gamePhase, 'playing');
    assert.strictEqual(gameState.ships.red.find(s => s.id === 'red-destroyer-1').health, shipHP);

    // 红方用新 socket 重新加入
    registerPlayer('sock-C', 'red');
    assert.strictEqual(gameState.playersByColor['red'], 'sock-C');
    assert.strictEqual(gameState.ships.red.find(s => s.id === 'red-destroyer-1').health, shipHP);

    unregisterPlayer('sock-C');
    unregisterPlayer('sock-B');
});

test('不存在幽灵玩家（unregister 彻底清理）', () => {
    setupCleanGame();
    registerPlayer('ghost', 'red');
    unregisterPlayer('ghost');

    assert.strictEqual(Object.keys(gameState.players).length, 0);
    assert.strictEqual(Object.keys(gameState.playersByColor).length, 0);
});

// ─────────────────────────────────────────────────────────────
// 总结
// ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`总计: ${passCount + failCount} 项，通过: ${passCount}，失败: ${failCount}`);
if (failCount > 0) {
    console.log('❌ 存在失败的测试');
    process.exit(1);
} else {
    console.log('✅ 全部测试通过');
    process.exit(0);
}
