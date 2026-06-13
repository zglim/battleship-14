/**
 * game.js —— Battleship 前端主逻辑
 *
 * 职责划分：
 *  - GameConfig (shared)  : 常量配置
 *  - GameRules  (shared)  : 规则校验纯函数
 *  - BattleshipGame 类    : 前端状态 + 渲染 + 用户交互
 *
 * 状态更新统一走 applyState()，渲染统一走 render()，
 * 避免在一个方法里既改状态又操作 DOM。
 */

/* global io, GameConfig, GameRules */

'use strict';

var BOARD_SIZE             = GameConfig.BOARD_SIZE;
var CELL_SIZE              = GameConfig.CELL_SIZE_PX;
var EXPLOSION_SIZE         = GameConfig.EXPLOSION_SIZE_PX;
var EXPLOSION_DURATION     = GameConfig.EXPLOSION_DURATION;
var MSG_DURATION           = GameConfig.MESSAGE_DEFAULT_DURATION;
var CENTER_MSG_DURATION    = GameConfig.CENTER_MESSAGE_DURATION;

/* ====================================================
 * 辅助：DOM 快捷方法
 * ==================================================== */
function $(id) { return document.getElementById(id); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

/* ====================================================
 * BattleshipGame
 * ==================================================== */
class BattleshipGame {

  /* -------- 构造 -------- */
  constructor() {
    this.socket        = io();
    this.boardSize     = BOARD_SIZE;

    // 前端独有状态
    this.currentPlayer = null;   // 'red' | 'blue'
    this.gameState     = null;   // 服务端推送的对局快照
    this.selectedShip  = null;   // 当前选中的船只 id
    this.currentAction = null;   // 'move' | 'attack' | 'rotate' | null
    this.shipElements  = new Map(); // shipId → DOM element

    this._createBoard();
    this._bindSocketEvents();
    this._bindUIEvents();
  }

  /* ====================================================
   * 状态更新入口
   * ==================================================== */

  /** 统一应用新的 gameState 快照并触发渲染 */
  _applyState(state) {
    this.gameState = state;
    this._render();
  }

  /* ====================================================
   * 渲染（纯 DOM 操作，不修改 gameState）
   * ==================================================== */

  _render() {
    if (!this.gameState) return;
    this._renderShips();
    this._renderObstacles();
    this._renderPhaseUI();
    this._renderStatusPanel();
    this._renderTurnIndicator();
    this._renderShipSelection();
    this._renderPlayerStatus();
  }

  /* -------- 棋盘 -------- */
  _createBoard() {
    var board = $('board');
    board.innerHTML = '';
    board.style.position = 'relative';
    for (var y = 0; y < this.boardSize; y++) {
      for (var x = 0; x < this.boardSize; x++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.x = x;
        cell.dataset.y = y;
        cell.addEventListener('click', this._onCellClick.bind(this, x, y));
        board.appendChild(cell);
      }
    }
  }

  _renderObstacles() {
    $all('.cell').forEach(function (c) { c.classList.remove('obstacle'); });
    var obs = this.gameState.obstacles;
    for (var i = 0; i < obs.length; i++) {
      var cell = $all('.cell').find(function (c) {
        return parseInt(c.dataset.x) === obs[i].x && parseInt(c.dataset.y) === obs[i].y;
      });
      if (cell) cell.classList.add('obstacle');
    }
  }

  /* -------- 船只 -------- */
  _renderShips() {
    var self = this;
    // 移除旧元素
    this.shipElements.forEach(function (el) { if (el.parentElement) el.remove(); });
    this.shipElements.clear();

    ['red', 'blue'].forEach(function (color) {
      self.gameState.ships[color].forEach(function (ship) {
        if (!ship.placed) return;
        var el = self._createShipElement(ship);
        $('board').appendChild(el);
        self.shipElements.set(ship.id, el);
        if (self.selectedShip === ship.id) el.classList.add('selected');
      });
    });

    // 清除格子上残留的船只样式
    $all('.cell').forEach(function (c) {
      c.classList.remove('ship-cell', 'damaged', 'sunk', 'selected-ship');
      c.style.backgroundImage = '';
      c.style.backgroundSize = '';
      c.style.backgroundPosition = '';
      c.style.transform = '';
      c.style.filter = '';
    });
  }

  _createShipElement(ship) {
    var shipType = (ship.type || ship.id.split('-')[0]).toLowerCase();
    var color    = ship.id.includes('red') ? 'red' : 'blue';

    var el = document.createElement('div');
    el.className = 'ship-element ' + ship.direction + ' ' + color;
    el.id = 'ship-' + ship.id;
    el.dataset.shipId = ship.id;

    // 图片
    var img = document.createElement('img');
    img.src = shipType + '.png';
    img.className = 'ship-image';
    img.alt = shipType + ' ship';
    if (ship.direction === 'horizontal') {
      img.style.width  = (ship.size * CELL_SIZE) + 'px';
      img.style.height = CELL_SIZE + 'px';
      img.style.transform = 'none';
    } else {
      img.style.width  = (ship.size * CELL_SIZE) + 'px';
      img.style.height = CELL_SIZE + 'px';
      img.style.transform = 'rotate(90deg)';
      img.style.transformOrigin = (CELL_SIZE / 2) + 'px ' + (CELL_SIZE / 2) + 'px';
    }
    el.appendChild(img);

    // 生命值
    var hp = document.createElement('div');
    hp.className = 'ship-health-display ' +
      (ship.health === ship.maxHealth ? 'full-health' : 'damaged-health');
    hp.textContent = ship.health;
    el.appendChild(hp);

    // 位置
    this._positionShipElement(el, ship);

    // 状态类
    if (ship.sunk) el.classList.add('sunk');
    else if (ship.health < ship.maxHealth) el.classList.add('damaged');

    // 行动状态
    el.classList.remove('action-available', 'action-taken');
    el.classList.add(ship.actionTaken ? 'action-taken' : 'action-available');

    return el;
  }

  _positionShipElement(el, ship) {
    el.style.left   = (ship.x * CELL_SIZE) + 'px';
    el.style.top    = (ship.y * CELL_SIZE) + 'px';
    el.style.width  = ((ship.direction === 'horizontal' ? ship.size : 1) * CELL_SIZE) + 'px';
    el.style.height = ((ship.direction === 'vertical'   ? ship.size : 1) * CELL_SIZE) + 'px';
  }

  /* -------- 阶段 / 状态面板 -------- */
  _renderPhaseUI() {
    var phase = this.gameState.gamePhase;
    var phaseEl = $('game-phase');
    if (phaseEl) phaseEl.textContent = phase === 'setup' ? '放置阶段' : '战斗阶段';

    var shipList = $('ship-list');
    var actionBtns = $('action-buttons');

    if (phase === 'setup') {
      if (shipList) shipList.style.display = 'block';
      if (actionBtns) actionBtns.style.display = 'none';
    } else {
      if (shipList) shipList.style.display = 'none';
      if (actionBtns) actionBtns.style.display = 'block';
      this._setActionButtonsEnabled(this.gameState.currentTurn === this.currentPlayer);
    }
  }

  _setActionButtonsEnabled(enabled) {
    $all('#action-buttons button').forEach(function (btn) {
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? '1' : '0.5';
    });
  }

  _renderStatusPanel() {
    var panel = $('status-panel');
    if (!panel || !this.gameState) return;
    var gs = this.gameState;
    panel.innerHTML =
      '<h3>游戏状态</h3>' +
      '<p>阶段: '   + (gs.gamePhase === 'setup' ? '放置阶段' : '战斗阶段') + '</p>' +
      '<p>当前回合: ' + gs.currentTurn + '</p>' +
      '<p>红方船只: ' + gs.ships.red.filter(function(s){return s.placed;}).length + '/' + gs.ships.red.length + '</p>' +
      '<p>蓝方船只: ' + gs.ships.blue.filter(function(s){return s.placed;}).length + '/' + gs.ships.blue.length + '</p>';
  }

  _renderTurnIndicator() {
    var el = $('turn-indicator');
    if (el && this.gameState) el.textContent = '当前回合: ' + this.gameState.currentTurn;
  }

  _renderShipSelection() {
    if (!this.gameState || !this.currentPlayer) return;
    var self = this;
    var shipList = $('ship-list');
    shipList.innerHTML = '';

    this.gameState.ships[this.currentPlayer].forEach(function (ship) {
      var item = document.createElement('div');
      item.className = 'ship-item' +
        (ship.placed ? ' placed' : '') +
        (ship.sunk   ? ' sunk'   : '');
      item.dataset.shipId = ship.id;

      var visual = self._createShipTopView(ship);
      item.innerHTML =
        '<div class="ship-info">' +
          '<strong>' + ship.name + '</strong>' +
          '<span class="ship-status">' +
            (ship.placed ? '✓ 已放置' : '未放置') + ' | ' +
            'HP: ' + ship.health + '/' + ship.maxHealth + ' | ' +
            (ship.sunk ? '💀 击沉' : '⚓ 正常') +
          '</span>' +
        '</div>' +
        '<div class="ship-visual">' + visual + '</div>';

      if (!ship.placed && !ship.sunk) {
        item.addEventListener('click', function () { self._selectShip(ship.id); });
        item.style.cursor = 'pointer';
      } else {
        item.style.cursor = 'default';
      }
      shipList.appendChild(item);
    });
  }

  _createShipTopView(ship) {
    var shipType = (ship.type || ship.id.split('-')[0]).toLowerCase();
    var imgPath  = shipType + '.png';
    if (ship.direction === 'horizontal') {
      return '<div class="ship-top-view horizontal" style="width:' + (ship.size * 20) + 'px;height:20px;background-image:url(\'' + imgPath + '\');background-size:cover;"></div>';
    }
    return '<div class="ship-top-view vertical" style="width:20px;height:' + (ship.size * 20) + 'px;background-image:url(\'' + imgPath + '\');background-size:cover;transform:rotate(90deg);"></div>';
  }

  _renderPlayerStatus() {
    var el = $('player-status');
    if (el && this.currentPlayer) {
      el.textContent = '当前玩家: ' + (this.currentPlayer === 'red' ? '红方' : '蓝方');
    }
  }

  /* -------- 选中状态渲染 -------- */
  _renderShipSelectionOnBoard() {
    this.shipElements.forEach(function (el) { el.classList.remove('selected'); });
    if (this.selectedShip) {
      var el = this.shipElements.get(this.selectedShip);
      if (el) el.classList.add('selected');
    }
  }

  /* ====================================================
   * 事件绑定
   * ==================================================== */

  _bindUIEvents() {
    var self = this;
    $('move-btn').addEventListener('click',   function () { self._startAction('move');   });
    $('attack-btn').addEventListener('click', function () { self._startAction('attack'); });
    $('rotate-btn').addEventListener('click', function () { self._startAction('rotate'); });
    $('end-turn-btn').addEventListener('click', function () { self._endTurn(); });
  }

  _bindSocketEvents() {
    var self = this;

    /* --- 状态同步 --- */
    this.socket.on('gameState', function (state) {
      self._applyState(state);
      if (self.currentPlayer) {
        var header = $('header');
        if (header) { header.classList.remove('red', 'blue'); header.classList.add(self.currentPlayer); }
      }
    });

    this.socket.on('gameStateUpdate', function (state) { self._applyState(state); });

    this.socket.on('gameStarted', function (state) { self._applyState(state); });

    this.socket.on('turnChanged', function (turn) {
      self._renderTurnIndicator();
      self.showCenterMessage((turn === self.currentPlayer ? '我方' : '对方') + '回合', CENTER_MSG_DURATION);
      // 重新渲染以更新按钮启禁用
      if (self.gameState) { self.gameState.currentTurn = turn; self._renderPhaseUI(); }
    });

    /* --- 船只放置 --- */
    this.socket.on('shipPlaced', function (ship) {
      if (self.gameState && self.currentPlayer) {
        var ships = self.gameState.ships[self.currentPlayer];
        var idx = ships.findIndex(function (s) { return s.id === ship.id; });
        if (idx !== -1) ships[idx] = Object.assign({}, ship);
      }
      self._render();
    });

    this.socket.on('opponentShipPlaced', function () { self._render(); });

    /* --- 动作结果 --- */
    this.socket.on('actionResult', function (result) {
      if (result.success) {
        self._render();
        self.showMessage(result.message, 'info', MSG_DURATION);
      } else {
        self.showMessage(result.message, 'error', MSG_DURATION);
      }
    });

    /* --- 攻击动画 --- */
    this.socket.on('attackResult', function (result) {
      if (!result.success) return;
      var text = '';
      if (result.attackPower === 0)       text = 'MISS';
      else if (result.attackPower === 1)  text = '命中';
      else if (result.attackPower === 2)  text = '击中要害';
      else if (result.attackPower >= 3)   text = '致命一击！！';

      self._showExplosionAnimation(result.targetX, result.targetY, result.attackPower);
      if (text) self.showCenterMessage(text, CENTER_MSG_DURATION);
    });

    /* --- 游戏结束 --- */
    this.socket.on('gameEnded', function (data) {
      self.gameState = self.gameState || {};
      self.gameState.gamePhase = 'ended';
      self.showCenterMessage(self.currentPlayer === data.winner ? '胜利' : '失败', 5000);
      self._render();

      // 允许重新加入
      var header = $('header');
      if (header) {
        var wrap = document.createElement('div');
        wrap.innerHTML =
          '<div style="text-align:center;margin:20px;">' +
            '<button onclick="joinGame(\'red\')"  style="padding:15px 30px;background:#FF4444;color:white;border:none;border-radius:5px;margin:10px;cursor:pointer;">加入红方</button>' +
            '<button onclick="joinGame(\'blue\')" style="padding:15px 30px;background:#4444FF;color:white;border:none;border-radius:5px;margin:10px;cursor:pointer;">加入蓝方</button>' +
          '</div>';
        header.appendChild(wrap);
        header.classList.remove('red', 'blue');
      }
    });
  }

  /* ====================================================
   * 用户交互 → 动作分发
   * ==================================================== */

  _onCellClick(x, y) {
    if (!this.gameState || !this.currentPlayer) return;

    if (this.gameState.gamePhase === 'setup') {
      if (this.selectedShip) this._placeShip(x, y);
      else this.showMessage('请先选择要放置的船只', 'warning', 2000);
      return;
    }

    if (this.gameState.gamePhase === 'playing') {
      // 优先尝试选择己方船只
      if (this._selectShipAt(x, y)) {
        this.currentAction = null;
      } else if (this.currentAction) {
        this._executeAction(x, y);
      }
    }
  }

  /* -------- 选择船只 -------- */
  _selectShip(shipId) {
    this.selectedShip = shipId;
    // 更新列表高亮
    $all('.ship-item').forEach(function (el) { el.classList.remove('selected'); });
    var item = document.querySelector('.ship-item[data-ship-id="' + shipId + '"]');
    if (item) item.classList.add('selected');
    this._renderShipSelectionOnBoard();
  }

  _selectShipAt(x, y) {
    var ships = this.gameState.ships[this.currentPlayer];
    for (var i = 0; i < ships.length; i++) {
      var ship = ships[i];
      if (!ship.placed || ship.sunk || ship.actionTaken) continue;
      if (GameRules.shipOccupiesCell(ship, x, y)) {
        this._selectShip(ship.id);
        return true;
      }
    }
    return false;
  }

  _getShip(shipId) {
    if (!this.gameState || !this.currentPlayer) return null;
    return this.gameState.ships[this.currentPlayer].find(function (s) { return s.id === shipId; });
  }

  /* -------- 动作发起 -------- */
  _startAction(type) {
    if (!this.selectedShip) {
      this.showMessage('请先选择要' + ({move:'移动',attack:'攻击',rotate:'转向'}[type]) + '的船只', 'warning', 2000);
      return;
    }
    var ship = this._getShip(this.selectedShip);
    if (!ship || !ship.placed || ship.sunk || ship.actionTaken) {
      this.showMessage('无法' + ({move:'移动',attack:'攻击',rotate:'转向'}[type]) + '该船只', 'error', 2000);
      return;
    }
    if (type === 'rotate' && ship.size === 1) {
      this.showMessage('大小为1的船只不需要旋转', 'error', 2000);
      return;
    }
    this.currentAction = type;
    this.showMessage(
      { move: '请点击目标位置移动船只', attack: '请点击目标位置进行攻击', rotate: '请点击转向方向' }[type],
      'info', MSG_DURATION
    );
  }

  _executeAction(x, y) {
    var ship = this._getShip(this.selectedShip);
    if (!ship || !ship.placed || ship.sunk || ship.actionTaken) {
      this.showMessage('该船不能行动', 'error', 2000);
      return;
    }
    switch (this.currentAction) {
      case 'move':   this._doMoveAction(x, y, ship);   break;
      case 'attack': this._doAttackAction(x, y, ship); break;
      case 'rotate': this._doRotateAction(x, y, ship); break;
    }
  }

  /* -------- 放置 -------- */
  _placeShip(x, y) {
    this.socket.emit('placeShip', {
      shipId: this.selectedShip, x: x, y: y, direction: 'horizontal'
    });
  }

  /* -------- 移动 -------- */
  _doMoveAction(x, y, ship) {
    var target = this._computeMoveTarget(x, y, ship);
    if (!target) return;

    // 前端用 GameRules 做即时校验（用户体验），服务端仍为权威
    var allShips = this.gameState.ships.red.concat(this.gameState.ships.blue);
    if (!GameRules.isValidMove(ship, target.x, target.y, this.gameState.obstacles, allShips, this.boardSize)) {
      this.showMessage('无效的移动位置', 'error', 2000);
      return;
    }

    this.socket.emit('shipAction', { type: 'move', shipId: ship.id, targetX: target.x, targetY: target.y });
    this.selectedShip  = null;
    this.currentAction = null;
    this.showMessage('船只移动完成', 'info', 2000);
  }

  /**
   * 根据点击位置计算移动目标坐标（只移动一格）
   * - size==1：上下左右一格
   * - size>1 水平：只能水平一格
   * - size>1 垂直：只能垂直一格
   */
  _computeMoveTarget(x, y, ship) {
    var newX = ship.x, newY = ship.y;
    if (ship.size === 1) {
      if ((x !== ship.x && y !== ship.y) || (x === ship.x && y === ship.y)) return null;
      if (x !== ship.x) newX = x > ship.x ? ship.x + 1 : ship.x - 1;
      if (y !== ship.y) newY = y > ship.y ? ship.y + 1 : ship.y - 1;
    } else if (ship.direction === 'horizontal') {
      if (x === ship.x || y !== ship.y) return null;
      newX = x < ship.x ? ship.x - 1 : ship.x + 1;
    } else {
      if (y === ship.y || x !== ship.x) return null;
      newY = y < ship.y ? ship.y - 1 : ship.y + 1;
    }
    return { x: newX, y: newY };
  }

  /* -------- 攻击 -------- */
  _doAttackAction(x, y, ship) {
    var enemyColor = this.currentPlayer === 'red' ? 'blue' : 'red';
    var enemyShips = this.gameState.ships[enemyColor];
    if (!GameRules.isValidAttack(ship, x, y, enemyShips, this.boardSize)) {
      // 细分提示
      if (!GameRules.isInBounds(x, y, this.boardSize)) { /* 边界外，不提示 */ return; }
      if (!GameRules.isEnemyCell(x, y, enemyShips)) { this.showMessage('目标位置没有对方船只', 'warning', 2000); return; }
      this.showMessage('超出攻击范围', 'warning', 2000);
      return;
    }
    this.socket.emit('shipAction', { type: 'attack', shipId: ship.id, targetX: x, targetY: y });
    this.selectedShip  = null;
    this.currentAction = null;
  }

  /* -------- 转向 -------- */
  _doRotateAction(x, y, ship) {
    var centerX = ship.x + (ship.direction === 'horizontal' ? ship.size / 2 : 0.5);
    var centerY = ship.y + (ship.direction === 'vertical'   ? ship.size / 2 : 0.5);
    var newX = ship.x, newY = ship.y;

    if (ship.direction === 'horizontal') {
      newX = x >= centerX ? Math.floor(centerX) : Math.ceil(centerX) - 1;
      newY = y >= centerY ? ship.y - Math.ceil(ship.size / 2) + 1 : ship.y - Math.floor(ship.size / 2);
    } else {
      newX = x >= centerX ? ship.x - Math.ceil(ship.size / 2) + 1 : ship.x - Math.floor(ship.size / 2);
      newY = y >= centerY ? Math.floor(centerY) : Math.ceil(centerY) - 1;
    }

    this.socket.emit('shipAction', { type: 'rotate', shipId: ship.id, targetX: newX, targetY: newY });
  }

  /* -------- 结束回合 -------- */
  _endTurn() {
    this.socket.emit('endTurn', this.currentPlayer);
    this.currentAction = null;
    this.selectedShip  = null;
    this.showMessage('回合结束', 'info', 2000);
  }

  /* ====================================================
   * 消息 / 动画
   * ==================================================== */

  showMessage(message, type, duration) {
    type     = type     || 'info';
    duration = duration || MSG_DURATION;
    var container = $('message-container');
    if (!container) return;

    var el = document.createElement('div');
    el.className = 'message ' + type;
    el.innerHTML = '<span>' + message + '</span>' +
      '<button class="message-close" onclick="this.parentElement.remove()">×</button>';
    container.appendChild(el);

    if (duration > 0) {
      setTimeout(function () {
        if (el.parentElement) {
          el.classList.add('fade-out');
          setTimeout(function () { if (el.parentElement) el.remove(); }, 300);
        }
      }, duration);
    }
  }

  showCenterMessage(text, duration) {
    duration = duration || CENTER_MSG_DURATION;
    var el = $('center-message');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // 重触发 CSS 动画
    el.classList.add('show');
    if (duration > 0) {
      setTimeout(function () { el.classList.remove('show'); }, duration);
    }
  }

  _showExplosionAnimation(x, y, attackPower) {
    var board = $('board');
    if (!board) return;
    var img = document.createElement('img');
    img.src = attackPower > 0 ? '/boom.gif' : '/miss.gif';
    img.className = 'explosion-animation';
    img.style.position   = 'absolute';
    img.style.width      = EXPLOSION_SIZE + 'px';
    img.style.height     = EXPLOSION_SIZE + 'px';
    img.style.pointerEvents = 'none';
    img.style.zIndex     = '100';
    var half = EXPLOSION_SIZE / 2;
    img.style.left = (x * CELL_SIZE + CELL_SIZE / 2 - half) + 'px';
    img.style.top  = (y * CELL_SIZE + CELL_SIZE / 2 - half) + 'px';
    board.appendChild(img);
    setTimeout(function () { if (img.parentElement) img.remove(); }, EXPLOSION_DURATION);
  }
}

/* ====================================================
 * 页面加载 & 加入游戏
 * ==================================================== */
document.addEventListener('DOMContentLoaded', function () {
  window.game = new BattleshipGame();

  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div style="text-align:center;margin:20px;">' +
      '<button onclick="joinGame(\'red\')"  style="padding:15px 30px;background:#FF4444;color:white;border:none;border-radius:5px;margin:10px;cursor:pointer;">加入红方</button>' +
      '<button onclick="joinGame(\'blue\')" style="padding:15px 30px;background:#4444FF;color:white;border:none;border-radius:5px;margin:10px;cursor:pointer;">加入蓝方</button>' +
    '</div>';
  $('header').appendChild(wrap);
});

function joinGame(color) {
  window.game.currentPlayer = color;
  window.game.socket.emit('joinGame', color);
  var header = $('header');
  if (header) { header.classList.remove('red', 'blue'); header.classList.add(color); }
  var joinContainer = document.querySelector('div[style*="text-align: center"]');
  if (joinContainer && joinContainer.parentElement) joinContainer.remove();
}
