/**
 * test/rules.test.js —— 游戏规则单元测试
 *
 * 使用 Node.js 内置 assert，无需额外测试框架。
 * 运行：node test/rules.test.js
 */

'use strict';

const assert     = require('assert');
const GameConfig = require('../shared/game-config');
const GameRules  = require('../shared/game-rules');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
  }
}

/* ====================================================
 * getShipCells
 * ==================================================== */
console.log('\n[getShipCells]');

test('水平船只返回正确格子', function () {
  const ship = { placed: true, x: 2, y: 3, direction: 'horizontal', size: 3 };
  const cells = GameRules.getShipCells(ship);
  assert.deepStrictEqual(cells, [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }]);
});

test('垂直船只返回正确格子', function () {
  const ship = { placed: true, x: 5, y: 1, direction: 'vertical', size: 2 };
  const cells = GameRules.getShipCells(ship);
  assert.deepStrictEqual(cells, [{ x: 5, y: 1 }, { x: 5, y: 2 }]);
});

test('未放置船只返回空数组', function () {
  const ship = { placed: false, x: -1, y: -1, direction: 'horizontal', size: 3 };
  assert.deepStrictEqual(GameRules.getShipCells(ship), []);
});

/* ====================================================
 * shipOccupiesCell
 * ==================================================== */
console.log('\n[shipOccupiesCell]');

test('命中占据的格子', function () {
  const ship = { placed: true, sunk: false, x: 1, y: 1, direction: 'horizontal', size: 2 };
  assert.strictEqual(GameRules.shipOccupiesCell(ship, 1, 1), true);
  assert.strictEqual(GameRules.shipOccupiesCell(ship, 2, 1), true);
  assert.strictEqual(GameRules.shipOccupiesCell(ship, 3, 1), false);
});

test('沉没船只不占据任何格子', function () {
  const ship = { placed: true, sunk: true, x: 1, y: 1, direction: 'horizontal', size: 2 };
  assert.strictEqual(GameRules.shipOccupiesCell(ship, 1, 1), false);
});

/* ====================================================
 * isInBounds
 * ==================================================== */
console.log('\n[isInBounds]');

test('棋盘内坐标返回 true', function () {
  assert.strictEqual(GameRules.isInBounds(0, 0, 16), true);
  assert.strictEqual(GameRules.isInBounds(15, 15, 16), true);
});

test('棋盘外坐标返回 false', function () {
  assert.strictEqual(GameRules.isInBounds(-1, 0, 16), false);
  assert.strictEqual(GameRules.isInBounds(0, 16, 16), false);
  assert.strictEqual(GameRules.isInBounds(16, 0, 16), false);
});

/* ====================================================
 * isShipInBounds
 * ==================================================== */
console.log('\n[isShipInBounds]');

test('水平船只完全在棋盘内', function () {
  assert.strictEqual(GameRules.isShipInBounds(13, 5, 'horizontal', 4, 16), false); // 13+3=16 越界
  assert.strictEqual(GameRules.isShipInBounds(12, 5, 'horizontal', 4, 16), true);  // 12+3=15 ok
});

test('垂直船只完全在棋盘内', function () {
  assert.strictEqual(GameRules.isShipInBounds(5, 13, 'vertical', 4, 16), false);
  assert.strictEqual(GameRules.isShipInBounds(5, 12, 'vertical', 4, 16), true);
});

/* ====================================================
 * isShipInZone
 * ==================================================== */
console.log('\n[isShipInZone]');

test('红方船只在左侧区域', function () {
  assert.strictEqual(GameRules.isShipInZone(0, 0, 'horizontal', 4, 'red', 16), true);   // 0..3 < 8
  assert.strictEqual(GameRules.isShipInZone(5, 0, 'horizontal', 4, 'red', 16), false);  // 5..8 含 8
});

test('蓝方船只在右侧区域', function () {
  assert.strictEqual(GameRules.isShipInZone(8, 0, 'horizontal', 4, 'blue', 16), true);   // 8..11 >= 8
  assert.strictEqual(GameRules.isShipInZone(7, 0, 'horizontal', 4, 'blue', 16), false);
});

/* ====================================================
 * isShipNotOnEdge
 * ==================================================== */
console.log('\n[isShipNotOnEdge]');

test('size<=2 船只可以放在边缘', function () {
  assert.strictEqual(GameRules.isShipNotOnEdge('horizontal', 2, 0, 0, 16), true);
});

test('size>2 水平船只不能放在 y=0', function () {
  assert.strictEqual(GameRules.isShipNotOnEdge('horizontal', 3, 0, 0, 16), false);
});

test('size>2 垂直船只不能放在 x=0', function () {
  assert.strictEqual(GameRules.isShipNotOnEdge('vertical', 3, 0, 0, 16), false);
});

test('size>2 水平船只不能放在 y=boardSize-1', function () {
  assert.strictEqual(GameRules.isShipNotOnEdge('horizontal', 3, 0, 15, 16), false);
});

/* ====================================================
 * collidesWithObstacles
 * ==================================================== */
console.log('\n[collidesWithObstacles]');

test('格子与障碍物重叠', function () {
  assert.strictEqual(GameRules.collidesWithObstacles([{ x: 5, y: 5 }], [{ x: 5, y: 5 }]), true);
});

test('格子与障碍物不重叠', function () {
  assert.strictEqual(GameRules.collidesWithObstacles([{ x: 5, y: 5 }], [{ x: 5, y: 6 }]), false);
});

/* ====================================================
 * collidesWithOtherShips
 * ==================================================== */
console.log('\n[collidesWithOtherShips]');

test('与其他已放置船只重叠', function () {
  const other = { id: 'b1', placed: true, sunk: false, x: 5, y: 5, direction: 'horizontal', size: 1 };
  assert.strictEqual(GameRules.collidesWithOtherShips([{ x: 5, y: 5 }], [other], 'a1'), true);
});

test('排除自身 id', function () {
  const self = { id: 'a1', placed: true, sunk: false, x: 5, y: 5, direction: 'horizontal', size: 1 };
  assert.strictEqual(GameRules.collidesWithOtherShips([{ x: 5, y: 5 }], [self], 'a1'), false);
});

test('沉没船只不算碰撞', function () {
  const sunk = { id: 'b1', placed: true, sunk: true, x: 5, y: 5, direction: 'horizontal', size: 1 };
  assert.strictEqual(GameRules.collidesWithOtherShips([{ x: 5, y: 5 }], [sunk], 'a1'), false);
});

/* ====================================================
 * isValidPlacement (完整放置校验)
 * ==================================================== */
console.log('\n[isValidPlacement]');

test('合法放置返回 true', function () {
  const ship = { id: 'r1', size: 3 };
  assert.strictEqual(
    GameRules.isValidPlacement(ship, 1, 2, 'horizontal', 'red', [], [], 16),
    true
  );
});

test('越界放置返回 false', function () {
  const ship = { id: 'r1', size: 4 };
  assert.strictEqual(
    GameRules.isValidPlacement(ship, 6, 0, 'horizontal', 'red', [], [], 16), // x=6..9 超出红方区域
    false
  );
});

test('障碍物上放置返回 false', function () {
  const ship = { id: 'r1', size: 1 };
  const obs = [{ x: 3, y: 3 }];
  assert.strictEqual(
    GameRules.isValidPlacement(ship, 3, 3, 'horizontal', 'red', obs, [], 16),
    false
  );
});

test('与其他船只重叠返回 false', function () {
  const ship = { id: 'r2', size: 1 };
  const existing = { id: 'r1', placed: true, sunk: false, x: 3, y: 3, direction: 'horizontal', size: 1 };
  assert.strictEqual(
    GameRules.isValidPlacement(ship, 3, 3, 'horizontal', 'red', [], [existing], 16),
    false
  );
});

test('蓝方船只不能放在左侧', function () {
  const ship = { id: 'b1', size: 1 };
  assert.strictEqual(
    GameRules.isValidPlacement(ship, 3, 3, 'horizontal', 'blue', [], [], 16),
    false
  );
});

/* ====================================================
 * isValidMoveDirection
 * ==================================================== */
console.log('\n[isValidMoveDirection]');

test('size==1 船只正交移动一格合法', function () {
  const ship = { size: 1, x: 5, y: 5, direction: 'horizontal' };
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 6, 5), true);
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 5, 6), true);
});

test('size==1 船只斜走非法', function () {
  const ship = { size: 1, x: 5, y: 5, direction: 'horizontal' };
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 6, 6), false);
});

test('size==1 船只不动非法', function () {
  const ship = { size: 1, x: 5, y: 5, direction: 'horizontal' };
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 5, 5), false);
});

test('水平船只只能水平移动一格', function () {
  const ship = { size: 3, x: 5, y: 5, direction: 'horizontal' };
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 6, 5), true);
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 5, 6), false); // y 变了
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 7, 5), false); // 超过一格
});

test('垂直船只只能垂直移动一格', function () {
  const ship = { size: 3, x: 5, y: 5, direction: 'vertical' };
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 5, 6), true);
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 6, 5), false);
  assert.strictEqual(GameRules.isValidMoveDirection(ship, 5, 7), false);
});

/* ====================================================
 * isValidMove (完整移动校验)
 * ==================================================== */
console.log('\n[isValidMove]');

test('合法移动返回 true', function () {
  const ship = { id: 'a', size: 1, x: 5, y: 5, direction: 'horizontal', placed: true, sunk: false };
  assert.strictEqual(GameRules.isValidMove(ship, 6, 5, [], [ship], 16), true);
});

test('移动出界返回 false', function () {
  const ship = { id: 'a', size: 1, x: 0, y: 5, direction: 'horizontal', placed: true, sunk: false };
  assert.strictEqual(GameRules.isValidMove(ship, -1, 5, [], [ship], 16), false);
});

test('移动到障碍物返回 false', function () {
  const ship = { id: 'a', size: 1, x: 5, y: 5, direction: 'horizontal', placed: true, sunk: false };
  assert.strictEqual(GameRules.isValidMove(ship, 6, 5, [{ x: 6, y: 5 }], [ship], 16), false);
});

test('移动到其他船只位置返回 false', function () {
  const ship = { id: 'a', size: 1, x: 5, y: 5, direction: 'horizontal', placed: true, sunk: false };
  const other = { id: 'b', size: 1, x: 6, y: 5, direction: 'horizontal', placed: true, sunk: false };
  assert.strictEqual(GameRules.isValidMove(ship, 6, 5, [], [ship, other], 16), false);
});

/* ====================================================
 * isValidRotation
 * ==================================================== */
console.log('\n[isValidRotation]');

test('合法转向返回 true', function () {
  assert.strictEqual(GameRules.isValidRotation('a', 'vertical', 3, 5, 5, [], [], 16), true);
});

test('转向后越界返回 false', function () {
  // 垂直 size=4 在 y=13 → 占据 y=13,14,15,16 → 16 越界
  assert.strictEqual(GameRules.isValidRotation('a', 'vertical', 4, 5, 13, [], [], 16), false);
});

test('转向后碰到障碍物返回 false', function () {
  assert.strictEqual(GameRules.isValidRotation('a', 'vertical', 3, 5, 5, [{ x: 5, y: 6 }], [], 16), false);
});

/* ====================================================
 * isValidAttack / isEnemyCell / isWithinAttackRange
 * ==================================================== */
console.log('\n[isValidAttack]');

test('有效攻击返回 true', function () {
  const attacker = { id: 'a', size: 2, x: 3, y: 5, direction: 'horizontal', placed: true, sunk: false, attackRange: 4 };
  const enemy    = { id: 'e', size: 1, x: 7, y: 5, direction: 'horizontal', placed: true, sunk: false };
  // attacker cells: (3,5),(4,5). target (7,5): same row, distance from (4,5) = 3 <= 4
  assert.strictEqual(GameRules.isValidAttack(attacker, 7, 5, [enemy], 16), true);
});

test('超出攻击范围返回 false', function () {
  const attacker = { id: 'a', size: 2, x: 0, y: 5, direction: 'horizontal', placed: true, sunk: false, attackRange: 3 };
  const enemy    = { id: 'e', size: 1, x: 5, y: 5, direction: 'horizontal', placed: true, sunk: false };
  // attacker cells: (0,5),(1,5). target (5,5): distance from (1,5) = 4 > 3
  assert.strictEqual(GameRules.isValidAttack(attacker, 5, 5, [enemy], 16), false);
});

test('目标不在敌方船只上返回 false', function () {
  const attacker = { id: 'a', size: 1, x: 5, y: 5, direction: 'horizontal', placed: true, sunk: false, attackRange: 5 };
  const enemy    = { id: 'e', size: 1, x: 7, y: 7, direction: 'horizontal', placed: true, sunk: false };
  assert.strictEqual(GameRules.isValidAttack(attacker, 7, 5, [enemy], 16), false); // (7,5) not on enemy
});

test('攻击出界返回 false', function () {
  const attacker = { id: 'a', size: 1, x: 5, y: 5, direction: 'horizontal', placed: true, sunk: false, attackRange: 5 };
  assert.strictEqual(GameRules.isValidAttack(attacker, 20, 5, [], 16), false);
});

/* ====================================================
 * computeAttackPower
 * ==================================================== */
console.log('\n[computeAttackPower]');

test('骰子1→伤害1', function () { assert.strictEqual(GameRules.computeAttackPower(1, 4), 1); });
test('骰子2→伤害2', function () { assert.strictEqual(GameRules.computeAttackPower(2, 4), 2); });
test('骰子6→满伤害(size)', function () { assert.strictEqual(GameRules.computeAttackPower(6, 3), 3); });
test('骰子3~5→伤害0', function () {
  assert.strictEqual(GameRules.computeAttackPower(3, 4), 0);
  assert.strictEqual(GameRules.computeAttackPower(4, 4), 0);
  assert.strictEqual(GameRules.computeAttackPower(5, 4), 0);
});

/* ====================================================
 * hasAvailableActions / allSunk
 * ==================================================== */
console.log('\n[hasAvailableActions / allSunk]');

test('有可行动船只', function () {
  const ships = [
    { placed: true, sunk: false, actionTaken: false },
    { placed: true, sunk: false, actionTaken: true }
  ];
  assert.strictEqual(GameRules.hasAvailableActions(ships), true);
});

test('所有船只都已行动', function () {
  const ships = [
    { placed: true, sunk: false, actionTaken: true },
    { placed: true, sunk: false, actionTaken: true }
  ];
  assert.strictEqual(GameRules.hasAvailableActions(ships), false);
});

test('全部沉没', function () {
  assert.strictEqual(GameRules.allSunk([{ sunk: true }, { sunk: true }]), true);
});

test('未全部沉没', function () {
  assert.strictEqual(GameRules.allSunk([{ sunk: true }, { sunk: false }]), false);
});

/* ====================================================
 * generateShipList / totalShipCount
 * ==================================================== */
console.log('\n[generateShipList / totalShipCount]');

test('生成正确数量的船只', function () {
  const redShips = GameRules.generateShipList('red');
  assert.strictEqual(redShips.length, GameRules.totalShipCount());
});

test('船只 id 包含颜色前缀', function () {
  const blueShips = GameRules.generateShipList('blue');
  assert.ok(blueShips.every(function (s) { return s.id.startsWith('blue-'); }));
});

test('船只初始状态正确', function () {
  const ships = GameRules.generateShipList('red');
  ships.forEach(function (s) {
    assert.strictEqual(s.placed, false);
    assert.strictEqual(s.sunk, false);
    assert.strictEqual(s.health, s.maxHealth);
  });
});

/* ====================================================
 * generateObstacles
 * ==================================================== */
console.log('\n[generateObstacles]');

test('障碍物数量在配置范围内', function () {
  const obs = GameRules.generateObstacles(16);
  assert.ok(obs.length >= GameConfig.OBSTACLE_MIN);
  assert.ok(obs.length <= GameConfig.OBSTACLE_MAX);
});

test('障碍物不重复', function () {
  const obs = GameRules.generateObstacles(16);
  const keys = obs.map(function (o) { return o.x + ',' + o.y; });
  assert.strictEqual(new Set(keys).size, keys.length);
});

test('障碍物在边界留白区域内', function () {
  const obs = GameRules.generateObstacles(16);
  obs.forEach(function (o) {
    assert.ok(o.x >= GameConfig.EDGE_MARGIN);
    assert.ok(o.x < 16 - GameConfig.EDGE_MARGIN);
  });
});

/* ====================================================
 * findTargetShip
 * ==================================================== */
console.log('\n[findTargetShip]');

test('找到目标位置的船只', function () {
  const ships = [
    { id: 'a', placed: true, sunk: false, x: 3, y: 3, direction: 'horizontal', size: 2 },
    { id: 'b', placed: true, sunk: false, x: 7, y: 7, direction: 'vertical', size: 3 }
  ];
  assert.strictEqual(GameRules.findTargetShip(4, 3, ships).id, 'a');
  assert.strictEqual(GameRules.findTargetShip(7, 8, ships).id, 'b');
  assert.strictEqual(GameRules.findTargetShip(0, 0, ships), null);
});

/* ====================================================
 * 汇总
 * ==================================================== */
console.log('\n====================================');
console.log('通过: ' + passed + '  失败: ' + failed);
console.log('====================================\n');

process.exit(failed > 0 ? 1 : 0);
