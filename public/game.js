class BattleshipGame {
    constructor() {
        this.socket = io();
        this.boardSize = 16;
        this.selectedShip = null;
        this.currentPlayer = null;
        this.gameState = null;
        this.currentAction = null;

        this.shipElements = new Map(); // 存储船只DOM元素

        this.initializeGame();
        this.setupEventListeners();
    }

    // 添加消息显示方法
    showMessage(message, type = 'info', duration = 3000) {
        const messageContainer = document.getElementById('message-container');
        if (!messageContainer) return;

        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.innerHTML = `
            <span>${message}</span>
            <button class="message-close" onclick="this.parentElement.remove()">×</button>
        `;

        messageContainer.appendChild(messageElement);

        // 自动移除消息
        if (duration > 0) {
            setTimeout(() => {
                if (messageElement.parentElement) {
                    messageElement.classList.add('fade-out');
                    setTimeout(() => {
                        if (messageElement.parentElement) {
                            messageElement.remove();
                        }
                    }, 300);
                }
            }, duration);
        }
    }

    // 中央大字消息显示（无背景，橙色，默认2秒）
    showCenterMessage(text, duration = 2000) {
        const el = document.getElementById('center-message');
        if (!el) {
            console.warn('未找到center-message元素');
            return;
        }
        el.textContent = text;
        el.classList.remove('show');
        // 强制重绘以重触发动画
        void el.offsetWidth;
        el.classList.add('show');

        if (duration > 0) {
            setTimeout(() => {
                el.classList.remove('show');
            }, duration);
        }
    }

    initializeGame() {
        this.createBoard();
        this.socket.on('gameState', (state) => {
            this.gameState = state;
            this.updateShipSelection();
            this.updateGameDisplay();
            this.renderBattleLog();
            this.renderCasualtyOverview();
            if (this.currentPlayer) {
                const header = document.getElementById('header');
                if (header) {
                    header.classList.remove('red', 'blue');
                    header.classList.add(this.currentPlayer);
                }
            }
        });

        this.socket.on('turnChanged', (turn) => {
            this.updateTurnIndicator(turn);
            this.showCenterMessage(`${turn === this.currentPlayer ? '我方' : '对方'}回合`, 2000);
        });

        this.socket.on('gameStarted', (state) => {
            this.gameState = state;
            this.updateGameDisplay();
            this.renderBattleLog();
            this.renderCasualtyOverview();
        });

        this.socket.on('shipPlaced', (ship) => {
            if (this.gameState && this.currentPlayer) {
                const playerShips = this.gameState.ships[this.currentPlayer];
                const shipIndex = playerShips.findIndex(s => s.id === ship.id);
                if (shipIndex !== -1) {
                    playerShips[shipIndex] = { ...ship };
                }
            }

            this.placeShipOnBoard(ship);
            this.updateShipSelection();
            this.updateStatusPanel();
            this.updateGameDisplay();
        });

        this.socket.on('gameStateUpdate', (state) => {
            this.gameState = state;
            this.updateShipSelection();
            this.updateGameDisplay();
            this.renderCasualtyOverview();
        });

        this.socket.on('opponentShipPlaced', (data) => {
            this.updateGameDisplay();
        });

        // 战报更新监听
        this.socket.on('battleLogUpdate', (battleLog) => {
            if (this.gameState) {
                this.gameState.battleLog = battleLog;
            }
            this.renderBattleLog();
        });

        // 添加动作结果监听
        this.socket.on('actionResult', (result) => {
            if (result.success) {
                this.updateGameDisplay();
                this.showMessage(result.message, 'info', 3000);
            } else {
                this.showMessage(result.message, 'error', 3000);
            }
        });

        // 游戏结束监听 - 显示结算面板
        this.socket.on('gameEnded', (data) => {
            this.gameState = this.gameState || {};
            this.gameState.gamePhase = 'ended';

            console.log(`游戏结束！赢家：${data.winner}，输家：${data.loser}`);
            if (this.currentPlayer === data.winner) {
                this.showCenterMessage('胜利', 5000);
            } else {
                this.showCenterMessage('失败', 5000);
            }

            this.updateGameDisplay();
            this.renderBattleLog();
            this.renderCasualtyOverview();

            // 显示结算面板
            this.showSettlementPanel(data);

            // 显示加入界面（允许重新加入）
            const header = document.getElementById('header');
            if (header) {
                const joinButtons = document.createElement('div');
                joinButtons.innerHTML = `
                    <div style="text-align: center; margin: 20px;">
                        <button onclick="joinGame('red')" style="padding: 15px 30px; background: #FF4444; color: white; border: none; border-radius: 5px; margin: 10px; cursor: pointer;">加入红方</button>
                        <button onclick="joinGame('blue')" style="padding: 15px 30px; background: #4444FF; color: white; border: none; border-radius: 5px; margin: 10px; cursor: pointer;">加入蓝方</button>
                    </div>
                `;
                header.appendChild(joinButtons);
                header.classList.remove('red', 'blue');
            }
        });

        // 在 initializeGame() 方法中添加攻击结果监听
        this.socket.on('attackResult', (result) => {
            if (result.success) {
                let text = '';
                if (result.attackPower === 0) {
                    text = 'MISS';
                }
                else {
                    if (result.attackPower == 1) text = '命中';
                    if (result.attackPower == 2) text = '击中要害';
                    if (result.attackPower >= 3) text = '致命一击！！';
                }
                // 显示爆炸动画
                this.showExplosionAnimation(result.targetX, result.targetY, result.attackPower);
                if (text) this.showCenterMessage(text, 2000);
            }
        });

    }

    // ===== 战报面板渲染 =====
    renderBattleLog() {
        const listEl = document.getElementById('battle-log-list');
        if (!listEl || !this.gameState || !this.gameState.battleLog) return;

        const logs = this.gameState.battleLog;
        listEl.innerHTML = '';

        logs.forEach(entry => {
            const div = document.createElement('div');
            div.className = `log-entry type-${entry.type}`;

            const time = new Date(entry.timestamp);
            const timeStr = `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}:${String(time.getSeconds()).padStart(2,'0')}`;

            let turnBadge = '';
            if (entry.turn) {
                turnBadge = `<span class="log-turn">R${entry.turn}</span>`;
            }

            // 对攻击类型特殊渲染
            if (entry.type === 'attack') {
                const diceHtml = `<span class="log-dice">🎲${entry.diceRoll}</span>`;
                let damageHtml;
                if (entry.attackPower > 0) {
                    damageHtml = `<span class="log-damage">-${entry.damageDealt}HP</span>`;
                } else {
                    damageHtml = `<span class="log-miss">未命中</span>`;
                }
                const targetName = entry.targetShipName || '未知';
                const sunkHtml = entry.sunk ? ' <span class="log-damage">💀击沉!</span>' : '';
                const coordStr = `(${entry.targetX},${entry.targetY})`;

                div.innerHTML = `<span class="log-time">${timeStr}</span>${turnBadge}${entry.colorName} ${entry.shipName} → ${coordStr} ${diceHtml} ${damageHtml} 目标:${targetName}${sunkHtml}`;
            } else {
                div.innerHTML = `<span class="log-time">${timeStr}</span>${turnBadge}${entry.message}`;
            }

            listEl.appendChild(div);
        });

        // 滚动到底部
        listEl.scrollTop = listEl.scrollHeight;
    }

    // ===== 战损概览渲染 =====
    renderCasualtyOverview() {
        if (!this.gameState) return;

        ['red', 'blue'].forEach(color => {
            const ships = this.gameState.ships[color] || [];
            const total = ships.length;
            const sunk = ships.filter(s => s.sunk).length;
            const remaining = ships.filter(s => !s.sunk && s.placed).length;
            const actionable = ships.filter(s => s.placed && !s.sunk && !s.actionTaken).length;

            const statsEl = document.getElementById(`${color}-casualty-stats`);
            const shipsEl = document.getElementById(`${color}-casualty-ships`);

            if (statsEl) {
                statsEl.innerHTML = `
                    <div class="casualty-stat remaining">
                        <span class="stat-value">${remaining}</span>
                        <span class="stat-label">剩余</span>
                    </div>
                    <div class="casualty-stat sunk">
                        <span class="stat-value">${sunk}</span>
                        <span class="stat-label">击沉</span>
                    </div>
                    <div class="casualty-stat actionable">
                        <span class="stat-value">${actionable}</span>
                        <span class="stat-label">可行动</span>
                    </div>
                `;
            }

            if (shipsEl) {
                shipsEl.innerHTML = '';
                ships.forEach(ship => {
                    const tag = document.createElement('span');
                    if (ship.sunk) {
                        tag.className = 'casualty-ship-tag dead';
                        tag.textContent = ship.name;
                    } else if (ship.health < ship.maxHealth) {
                        tag.className = 'casualty-ship-tag damaged';
                        tag.textContent = `${ship.name} (${ship.health}/${ship.maxHealth})`;
                    } else if (ship.placed) {
                        tag.className = 'casualty-ship-tag alive';
                        tag.textContent = `${ship.name} (${ship.health}/${ship.maxHealth})`;
                    } else {
                        tag.className = 'casualty-ship-tag';
                        tag.textContent = `${ship.name} (未部署)`;
                    }
                    shipsEl.appendChild(tag);
                });
            }
        });
    }

    // ===== 结算面板 =====
    showSettlementPanel(data) {
        const modal = document.getElementById('settlement-modal');
        const titleEl = document.getElementById('settlement-title');
        const bodyEl = document.getElementById('settlement-body');
        if (!modal || !bodyEl) return;

        const winnerName = data.winnerName || (data.winner === 'red' ? '红方' : '蓝方');
        const loserName = data.loserName || (data.loser === 'red' ? '红方' : '蓝方');

        titleEl.textContent = `${winnerName} 获胜！`;

        // 最后一击信息
        let lastBlowHtml = '';
        if (data.lastBlow) {
            const lb = data.lastBlow;
            lastBlowHtml = `
                <div class="settlement-section">
                    <h4>最后一击</h4>
                    <div class="settlement-last-blow">
                        <div class="settlement-row"><span class="label">攻击方</span><span class="value">${lb.attackerColorName} ${lb.attackerShipName}</span></div>
                        <div class="settlement-row"><span class="label">目标</span><span class="value">${lb.targetColorName} ${lb.targetShipName || '未知'}</span></div>
                        <div class="settlement-row"><span class="label">坐标</span><span class="value">(${lb.targetX}, ${lb.targetY})</span></div>
                        <div class="settlement-row"><span class="label">掷骰</span><span class="value">${lb.diceRoll}</span></div>
                        <div class="settlement-row"><span class="label">伤害</span><span class="value">${lb.damageDealt > 0 ? lb.damageDealt + ' 点' : '未命中'}</span></div>
                        <div class="settlement-row"><span class="label">结果</span><span class="value">${lb.sunk ? '击沉！' : '命中'}</span></div>
                        <div class="settlement-row"><span class="label">回合</span><span class="value">第 ${lb.turn} 回合</span></div>
                    </div>
                </div>
            `;
        }

        // 关键战报摘要（击沉事件）
        let sunkListHtml = '';
        if (data.sunkEvents && data.sunkEvents.length > 0) {
            const items = data.sunkEvents.map(e => `<li>第${e.turn}回合 - ${e.message}</li>`).join('');
            sunkListHtml = `
                <div class="settlement-section">
                    <h4>击沉记录</h4>
                    <ul class="settlement-sunk-list">${items}</ul>
                </div>
            `;
        }

        bodyEl.innerHTML = `
            <div class="settlement-winner ${data.winner}">
                🏆 ${winnerName} 取得最终胜利！
            </div>
            <div class="settlement-section">
                <h4>对局概况</h4>
                <div class="settlement-row"><span class="label">赢家</span><span class="value">${winnerName}</span></div>
                <div class="settlement-row"><span class="label">输家</span><span class="value">${loserName}</span></div>
                <div class="settlement-row"><span class="label">总回合数</span><span class="value">${data.totalTurns}</span></div>
                <div class="settlement-row"><span class="label">红方剩余</span><span class="value">${data.redRemaining} 艘（被击沉 ${data.redSunk} 艘）</span></div>
                <div class="settlement-row"><span class="label">蓝方剩余</span><span class="value">${data.blueRemaining} 艘（被击沉 ${data.blueSunk} 艘）</span></div>
            </div>
            ${lastBlowHtml}
            ${sunkListHtml}
        `;

        modal.style.display = 'flex';

        // 关闭按钮
        const closeBtn = document.getElementById('settlement-close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => { modal.style.display = 'none'; };
        }
    }

    createBoard() {
        const board = document.getElementById('board');
        board.innerHTML = '';
        board.style.position = 'relative';

        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;

                cell.addEventListener('click', () => this.handleCellClick(x, y));
                board.appendChild(cell);
            }
        }
    }

    setupEventListeners() {
        document.getElementById('move-btn').addEventListener('click', () => this.moveShip());
        document.getElementById('attack-btn').addEventListener('click', () => this.attack());
        document.getElementById('rotate-btn').addEventListener('click', () => this.rotateShip());
        document.getElementById('end-turn-btn').addEventListener('click', () => this.endTurn());
    }

    // 更新船只选择界面
    updateShipSelection() {
        if (!this.gameState || !this.currentPlayer) return;

        const shipList = document.getElementById('ship-list');
        shipList.innerHTML = '';

        const playerShips = this.gameState.ships[this.currentPlayer];

        playerShips.forEach(ship => {
            const shipItem = document.createElement('div');
            shipItem.className = `ship-item ${ship.placed ? 'placed' : ''} ${ship.sunk ? 'sunk' : ''}`;
            shipItem.dataset.shipId = ship.id;

            const shipVisual = this.createShipTopView(ship);

            shipItem.innerHTML = `
                <div class="ship-info">
                    <strong>${ship.name}</strong>
                    <span class="ship-status">
                        ${ship.placed ? '✓ 已放置' : '未放置'} |
                        HP: ${ship.health}/${ship.maxHealth} |
                        ${ship.sunk ? '💀 击沉' : '⚓ 正常'}
                    </span>
                </div>
                <div class="ship-visual">
                    ${shipVisual}
                </div>
            `;

            if (!ship.placed && !ship.sunk) {
                shipItem.addEventListener('click', () => this.selectShip(ship.id));
                shipItem.style.cursor = 'pointer';
            } else {
                shipItem.style.cursor = 'default';
            }

            shipList.appendChild(shipItem);
        });
    }

    createShipTopView(ship) {
        const shipType = (ship.type || ship.id.split('-')[0]).toLowerCase();
        const imagePath = `${shipType}.png`;

        let visualHTML = '';

        if (ship.direction === 'horizontal') {
            visualHTML = `<div class="ship-top-view horizontal" style="width: ${ship.size * 20}px; height: 20px; background-image: url('${imagePath}'); background-size: cover;"></div>`;
        } else {
            visualHTML = `<div class="ship-top-view vertical" style="width: 20px; height: ${ship.size * 20}px; background-image: url('${imagePath}'); background-size: cover; transform: rotate(90deg);"></div>`;
        }

        return visualHTML;
    }

    getShipCellClass(ship, cellIndex) {
        if (ship.sunk) return 'sunk';
        if (ship.health <= cellIndex) return 'damaged';
        return '';
    }

    selectShip(shipId) {
        this.selectedShip = shipId;

        document.querySelectorAll('.ship-item').forEach(item => {
            item.classList.remove('selected');
        });

        const selectedItem = document.querySelector(`.ship-item[data-ship-id="${shipId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        this.updateShipSelectionOnBoard();
    }

    updateShipSelectionOnBoard() {
        this.shipElements.forEach((element, shipId) => {
            element.classList.remove('selected');
        });

        if (this.selectedShip) {
            const shipElement = this.shipElements.get(this.selectedShip);
            if (shipElement) {
                shipElement.classList.add('selected');
            }
        }
    }

    getShipById(shipId) {
        if (!this.gameState || !this.currentPlayer) return null;

        const playerShips = this.gameState.ships[this.currentPlayer];
        return playerShips.find(ship => ship.id === shipId);
    }

    handleCellClick(x, y) {
        if (!this.gameState || !this.currentPlayer) return;

        if (this.gameState.gamePhase === 'setup') {
            if (this.selectedShip) {
                this.placeShip(x, y);
            } else {
                this.showMessage('请先选择要放置的船只', 'warning', 2000);
            }
        } else if (this.gameState.gamePhase === 'playing') {
            if (this.selectShipAtPosition(x, y)) {
                this.currentAction = null;
            } else {
                if (this.currentAction) {
                    this.handleGameAction(x, y);
                }
            }
        }
    }

    selectShipAtPosition(x, y) {
        const playerShips = this.gameState.ships[this.currentPlayer];
        for (const ship of playerShips) {
            if (!ship.placed || ship.sunk || ship.actionTaken) continue;

            for (let i = 0; i < ship.size; i++) {
                const shipX = ship.direction === 'horizontal' ? ship.x + i : ship.x;
                const shipY = ship.direction === 'vertical' ? ship.y + i : ship.y;

                if (shipX === x && shipY === y) {
                    this.selectShip(ship.id);
                    return true;
                }
            }
        }
        return false;
    }

    createShipElement(ship) {
        const shipElement = document.createElement('div');
        const shipType = (ship.type || ship.id.split('-')[0]).toLowerCase();
        const color = ship.id.includes('red') ? 'red' : 'blue';

        shipElement.className = `ship-element ${ship.direction} ${color}`;
        shipElement.id = `ship-${ship.id}`;
        shipElement.dataset.shipId = ship.id;

        const shipImage = document.createElement('img');
        shipImage.src = `${shipType}.png`;
        shipImage.className = 'ship-image';
        shipImage.alt = `${shipType} ship`;

        if (ship.direction === 'horizontal') {
            shipImage.style.width = `${ship.size * 40}px`;
            shipImage.style.height = '40px';
            shipImage.style.transform = 'none';
        } else {
            shipImage.style.width = `${ship.size * 40}px`;
            shipImage.style.height = '40px';
            shipImage.style.transform = 'rotate(90deg)';
            shipImage.style.transformOrigin = '20px 20px';
        }

        shipElement.appendChild(shipImage);

        const healthDisplay = document.createElement('div');
        healthDisplay.className = 'ship-health-display';
        healthDisplay.textContent = ship.health;

        if (ship.health === ship.maxHealth) {
            healthDisplay.classList.add('full-health');
        } else {
            healthDisplay.classList.add('damaged-health');
        }

        shipElement.appendChild(healthDisplay);

        this.updateShipElementPosition(shipElement, ship);

        if (ship.sunk) {
            shipElement.classList.add('sunk');
        } else if (ship.health < ship.maxHealth) {
            shipElement.classList.add('damaged');
        }

        this.updateShipActionStatus(shipElement, ship);

        return shipElement;
    }

    updateShipActionStatus(shipElement, ship) {
        shipElement.classList.remove('action-available', 'action-taken');

        if (ship.actionTaken) {
            shipElement.classList.add('action-taken');
        } else {
            shipElement.classList.add('action-available');
        }
    }

    updateShipElementPosition(shipElement, ship) {
        const cellSize = 40;

        if (ship.direction === 'horizontal') {
            shipElement.style.left = `${ship.x * cellSize}px`;
            shipElement.style.top = `${ship.y * cellSize}px`;
            shipElement.style.width = `${ship.size * cellSize}px`;
            shipElement.style.height = `${cellSize}px`;
        } else {
            shipElement.style.left = `${ship.x * cellSize}px`;
            shipElement.style.top = `${ship.y * cellSize}px`;
            shipElement.style.width = `${cellSize}px`;
            shipElement.style.height = `${ship.size * cellSize}px`;
        }
    }

    updateShipsDisplay() {
        const board = document.getElementById('board');

        this.shipElements.forEach((element, shipId) => {
            if (element.parentElement) {
                element.remove();
            }
        });
        this.shipElements.clear();

        ['red', 'blue'].forEach(color => {
            this.gameState.ships[color].forEach(ship => {
                if (ship.placed) {
                    const shipElement = this.createShipElement(ship);
                    board.appendChild(shipElement);
                    this.shipElements.set(ship.id, shipElement);

                    if (this.selectedShip === ship.id) {
                        shipElement.classList.add('selected');
                    }
                }
            });
        });

        const cells = document.querySelectorAll('.cell');
        cells.forEach(cell => {
            cell.classList.remove('ship-cell', 'damaged', 'sunk', 'selected-ship');
            cell.style.backgroundImage = '';
            cell.style.backgroundSize = '';
            cell.style.backgroundPosition = '';
            cell.style.transform = '';
            cell.style.filter = '';
        });
    }

    placeShipOnBoard(ship) {
        const existingElement = this.shipElements.get(ship.id);
        if (existingElement && existingElement.parentElement) {
            existingElement.remove();
        }

        const shipElement = this.createShipElement(ship);
        const board = document.getElementById('board');
        board.appendChild(shipElement);
        this.shipElements.set(ship.id, shipElement);

        this.updateShipSelectionOnBoard();
    }

    moveShipWithAnimation(shipId, newX, newY) {
        const ship = this.getShipById(shipId);
        if (!ship) return;

        const shipElement = this.shipElements.get(shipId);
        if (!shipElement) return;

        ship.x = newX;
        ship.y = newY;

        this.updateShipElementPosition(shipElement, ship);
    }

    rotateShipWithAnimation(shipId) {
        const ship = this.getShipById(shipId);
        if (!ship) return;

        const shipElement = this.shipElements.get(shipId);
        if (!shipElement) return;

        ship.direction = ship.direction === 'horizontal' ? 'vertical' : 'horizontal';

        shipElement.className = shipElement.className.replace(/(horizontal|vertical)/, ship.direction);

        const shipImage = shipElement.querySelector('.ship-image');
        if (shipImage) {
            if (ship.direction === 'horizontal') {
                shipImage.style.width = `${ship.size * 40}px`;
                shipImage.style.height = '40px';
                shipImage.style.transform = 'none';
            } else {
                shipImage.style.width = `${ship.size * 40}px`;
                shipImage.style.height = '40px';
                shipImage.style.transform = 'rotate(90deg)';
                shipImage.style.transformOrigin = '20px 20px';
            }
        }

        this.updateShipElementPosition(shipElement, ship);
    }

    handleMoveAction(x, y, ship) {
        let newX = ship.x;
        let newY = ship.y;

        if(ship.size == 1) {
            if ((x!== ship.x && y!== ship.y) || (x === ship.x && y === ship.y) ) {
                return;
            }
            if (x !== ship.x) {
                newX = x > ship.x ? ship.x + 1 : ship.x - 1;
            }
            if (y !== ship.y) {
                newY = y > ship.y ? ship.y + 1 : ship.y - 1;
            }
        }else{
            if (ship.direction === 'horizontal') {
                if( x === ship.x || y !== ship.y ) {
                    return;
                }
                newX = x < ship.x ? ship.x - 1 : ship.x + 1;
            } else {
                if( y === ship.y || x !== ship.x ) {
                    return;
                }
                newY = y < ship.y ? ship.y - 1 : ship.y + 1;
            }
        }

        const isValid = this.isValidMove(newX, newY, ship);
        if (!isValid) {
            let errorMessage = '无效的移动位置。原因：';

            if (newX < 0 || newX >= this.boardSize || newY < 0 || newY >= this.boardSize) {
                errorMessage += '超出棋盘边界；';
            }
            if (ship.size >1 && ship.direction === 'horizontal' && (newX + ship.size -1 >= this.boardSize)) {
                errorMessage += '超出棋盘边界；';
            }
            if (ship.size >1 && ship.direction === 'vertical' && (newY + ship.size -1 >= this.boardSize)) {
                errorMessage += '超出棋盘边界；';
            }

            if (this.gameState.obstacles.some(obs => {
                for (let i = 0; i < ship.size; i++) {
                    const shipX = ship.direction === 'horizontal' ? newX + i : newX;
                    const shipY = ship.direction === 'vertical' ? newY + i : newY;
                    if (obs.x === shipX && obs.y === shipY) {
                        return true;
                    }
                }
                return false;
            })) {
                errorMessage += '目标位置有障碍物；';
            }

            const playerShips = this.gameState.ships[this.currentPlayer];
            for (const otherShip of playerShips) {
                if (otherShip.id === ship.id || !otherShip.placed || otherShip.sunk) continue;

                for (let i = 0; i < ship.size; i++) {
                    const shipX = ship.direction === 'horizontal' ? newX + i : newX;
                    const shipY = ship.direction === 'vertical' ? newY + i : newY;

                    for (let j = 0; j < otherShip.size; j++) {
                        const otherX = otherShip.direction === 'horizontal' ? otherShip.x + j : otherShip.x;
                        const otherY = otherShip.direction === 'vertical' ? otherShip.y + j : otherShip.y;

                        if (shipX === otherX && shipY === otherY) {
                            errorMessage += `与船只${otherShip.name}重叠；`;
                            break;
                        }
                    }
                }
            }

            this.showMessage(errorMessage, 'error', 2000);
            return;
        }

        console.log(`请求移动船只${ship.id}，原位置(${ship.x}, ${ship.y})到位置(${newX}, ${newY})`);
        this.socket.emit('shipAction', {
            type: 'move',
            shipId: ship.id,
            targetX: newX,
            targetY: newY
        });

        this.selectedShip = null;
        this.currentAction = null;
        this.showMessage('船只移动完成', 'info', 2000);
    }

    isValidMove(newX, newY, ship) {
        if (newX < 0 || newX >= this.boardSize || newY < 0 || newY >= this.boardSize) {
            return false;
        }

        if (ship.size == 1) {
            if (Math.abs(newX - ship.x) > 1 && Math.abs(newY - ship.y) > 1) return false;
        } else {
            if (ship.direction === 'horizontal') {
                if (newY !== ship.y) return false;
                if (Math.abs(newX - ship.x) > 1) return false;
            } else {
                if (newX !== ship.x) return false;
                if (Math.abs(newY - ship.y) > 1) return false;
            }
        }

        for (let i = 0; i < ship.size; i++) {
            const shipX = ship.direction === 'horizontal' ? newX + i : newX;
            const shipY = ship.direction === 'vertical' ? newY + i : newY;

            if (this.gameState.obstacles.some(obs => obs.x === shipX && obs.y === shipY)) {
                return false;
            }
        }

        const playerShips = this.gameState.ships[this.currentPlayer];
        for (const otherShip of playerShips) {
            if (otherShip.id === ship.id || !otherShip.placed || otherShip.sunk) continue;

            for (let i = 0; i < ship.size; i++) {
                const shipX = ship.direction === 'horizontal' ? newX + i : newX;
                const shipY = ship.direction === 'vertical' ? newY + i : newY;

                for (let j = 0; j < otherShip.size; j++) {
                    const otherX = otherShip.direction === 'horizontal' ? otherShip.x + j : otherShip.x;
                    const otherY = otherShip.direction === 'vertical' ? otherShip.y + j : otherShip.y;

                    if (shipX === otherX && shipY === otherY) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    isValidAttack(x, y, ship) {
        if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
            return false;
        }
        if (!ship) return false;

        const opponent = this.currentPlayer === 'red' ? 'blue' : 'red';
        const opponentShips = (this.gameState && this.gameState.ships) ? this.gameState.ships[opponent] : [];
        let targetIsEnemyCell = false;
        for (const otherShip of opponentShips) {
            if (!otherShip.placed || otherShip.sunk) continue;
            for (let i = 0; i < otherShip.size; i++) {
                const ox = otherShip.direction === 'horizontal' ? otherShip.x + i : otherShip.x;
                const oy = otherShip.direction === 'vertical' ? otherShip.y + i : otherShip.y;
                if (ox === x && oy === y) {
                    targetIsEnemyCell = true;
                    break;
                }
            }
            if (targetIsEnemyCell) break;
        }
        if (!targetIsEnemyCell) {
            this.showMessage('目标位置没有对方船只', 'warning', 2000);
            return false;
        }

        const attackerCells = [];
        for (let i = 0; i < ship.size; i++) {
            const ax = ship.direction === 'horizontal' ? ship.x + i : ship.x;
            const ay = ship.direction === 'vertical' ? ship.y + i : ship.y;
            attackerCells.push({ x: ax, y: ay });
        }

        const range = ship.attackRange || 0;
        for (const a of attackerCells) {
            if (a.y === y && Math.abs(a.x - x) <= range) return true;
            if (a.x === x && Math.abs(a.y - y) <= range) return true;
        }

        this.showMessage('超出攻击范围', 'warning', 2000);
        return false;
    }

    updateGameDisplay() {
        this.updateShipsDisplay();
        this.updateObstacles();
        this.updateGamePhaseDisplay();
        this.updateStatusPanel();
        this.updatePlayerStatus();
        this.updateTurnIndicator(this.gameState.currentTurn);
        this.updateTurnCountDisplay();
    }

    updateTurnCountDisplay() {
        const el = document.getElementById('turn-count');
        if (el && this.gameState) {
            el.textContent = this.gameState.turnCount || 1;
        }
    }

    updateObstacles() {
        const cells = document.querySelectorAll('.cell');
        cells.forEach(cell => {
            cell.classList.remove('obstacle');
        });

        this.gameState.obstacles.forEach(obs => {
            const cell = Array.from(document.querySelectorAll('.cell')).find(c =>
                parseInt(c.dataset.x) === obs.x && parseInt(c.dataset.y) === obs.y
            );
            if (cell) {
                cell.classList.add('obstacle');
            }
        });
    }

    updateGamePhaseDisplay() {
        const phaseElement = document.getElementById('game-phase');
        if (phaseElement) {
            phaseElement.textContent = this.gameState.gamePhase === 'setup' ? '放置阶段' : '战斗阶段';
        }

        const shipList = document.getElementById('ship-list');
        const actionButtons = document.getElementById('action-buttons');

        if (this.gameState.gamePhase === 'setup') {
            if (shipList) shipList.style.display = 'block';
            if (actionButtons) actionButtons.style.display = 'none';
        } else {
            if (shipList) shipList.style.display = 'none';
            if (actionButtons) actionButtons.style.display = 'block';

            if (this.gameState.currentTurn === this.currentPlayer) {
                this.enableActionButtons();
            } else {
                this.disableActionButtons();
            }
        }
    }

    enableActionButtons() {
        const buttons = document.querySelectorAll('#action-buttons button');
        buttons.forEach(button => {
            button.disabled = false;
            button.style.opacity = '1';
        });
    }

    disableActionButtons() {
        const buttons = document.querySelectorAll('#action-buttons button');
        buttons.forEach(button => {
            button.disabled = true;
            button.style.opacity = '0.5';
        });
    }

    showActionButtons() {
        const actionButtons = document.getElementById('action-buttons');
        if (actionButtons) {
            actionButtons.style.display = 'block';
        }
    }

    hideActionButtons() {
        const actionButtons = document.getElementById('action-buttons');
        if (actionButtons) {
            actionButtons.style.display = 'none';
        }
    }

    updateStatusPanel() {
        const statusPanel = document.getElementById('status-panel');
        if (!statusPanel || !this.gameState) return;

        statusPanel.innerHTML = `
            <h3>游戏状态</h3>
            <p>阶段: ${this.gameState.gamePhase === 'setup' ? '放置阶段' : '战斗阶段'}</p>
            <p>当前回合: ${this.gameState.currentTurn}</p>
            <p>红方船只: ${this.gameState.ships.red.filter(s => s.placed).length}/${this.gameState.ships.red.length}</p>
            <p>蓝方船只: ${this.gameState.ships.blue.filter(s => s.placed).length}/${this.gameState.ships.blue.length}</p>
        `;
    }

    updatePlayerStatus() {
        const playerStatus = document.getElementById('player-status');
        if (!playerStatus || !this.currentPlayer) return;

        playerStatus.textContent = `当前玩家: ${this.currentPlayer === 'red' ? '红方' : '蓝方'}`;
    }

    showActionHint(message) {
        const hintElement = document.getElementById('action-hint');
        if (hintElement) {
            hintElement.textContent = message;
            hintElement.style.display = 'block';
        }
    }

    hideActionHint() {
        const hintElement = document.getElementById('action-hint');
        if (hintElement) {
            hintElement.style.display = 'none';
        }
    }

    handleGameAction(x, y) {
        if (!this.selectedShip) {
            return;
        }

        const ship = this.getShipById(this.selectedShip);
        if (!ship || !ship.placed || ship.sunk || ship.actionTaken) {
            this.showMessage('该船不能行动', 'error', 2000);
            return;
        }

        if (this.currentAction === 'move') {
            this.handleMoveAction(x, y, ship);
        } else if (this.currentAction === 'attack') {
            this.handleAttackAction(x, y, ship);
        } else if (this.currentAction === 'rotate') {
            this.handleRotateShip(x, y, ship);
        }
    }

    handleAttackAction(x, y, ship) {
        const isValid = this.isValidAttack(x, y, ship);
        if (!isValid) {
            return;
        }

        console.log(`请求船只${ship.id}攻击位置(${x}, ${y})`);
        this.socket.emit('shipAction', {
            type: 'attack',
            shipId: ship.id,
            targetX: x,
            targetY: y
        });

        this.selectedShip = null;
        this.currentAction = null;
    }

    moveShip() {
        if (!this.selectedShip) {
            this.showMessage('请先选择要移动的船只', 'warning', 2000);
            return;
        }

        const ship = this.getShipById(this.selectedShip);
        if (!ship || !ship.placed || ship.sunk || ship.actionTaken) {
            this.showMessage('无法移动该船只', 'error', 2000);
            return;
        }

        this.currentAction = 'move';
        this.showMessage('请点击目标位置移动船只', 'info', 3000);
    }

    attack() {
        if (!this.selectedShip) {
            this.showMessage('请先选择要攻击的船只', 'warning', 2000);
            return;
        }

        const ship = this.getShipById(this.selectedShip);
        if (!ship || !ship.placed || ship.sunk || ship.actionTaken) {
            this.showMessage('无法使用该船只攻击', 'error', 2000);
            return;
        }

        this.currentAction = 'attack';
        this.showMessage('请点击目标位置进行攻击', 'info', 3000);
    }

    rotateShip() {
        if (!this.selectedShip) {
            this.showMessage('请先选择要转向的船只', 'warning', 2000);
            return;
        }

        const ship = this.getShipById(this.selectedShip);
        if (!ship || !ship.placed || ship.sunk || ship.actionTaken) {
            this.showMessage('无法旋转该船只', 'error', 2000);
            return;
        }

        if (ship.size === 1) {
            this.showMessage('大小为1的船只不需要旋转', 'error', 2000);
            return;
        }

        this.currentAction = 'rotate';
        this.showMessage('请点击转向方向', 'info', 3000);
    }

    handleRotateShip(x, y, ship) {
        const centerX = ship.x + (ship.direction === 'horizontal' ? ship.size/ 2 : 0.5);
        const centerY = ship.y + (ship.direction === 'vertical' ? ship.size/ 2 : 0.5);

        let newX = ship.x;
        let newY = ship.y;

        if (ship.direction === 'horizontal') {
            newX = x >= centerX ? Math.floor(centerX) : Math.ceil(centerX) - 1;
            newY = y >= centerY ? ship.y - Math.ceil(ship.size / 2) + 1 : ship.y - Math.floor(ship.size / 2);
        } else {
            newX = x >= centerX ? ship.x - Math.ceil(ship.size / 2) + 1 : ship.x - Math.floor(ship.size / 2);
            newY = y >= centerY ? Math.floor(centerY) : Math.ceil(centerY) - 1;
        }
        console.log(`船位置(${ship.x}, ${ship.y})，中心点(${centerX}, ${centerY})，点击点(${x}, ${y})，新位置(${newX}, ${newY})`);


        this.socket.emit('shipAction', {
            type: 'rotate',
            shipId: ship.id,
            targetX: newX,
            targetY: newY
        });
    }

    endTurn() {
        this.socket.emit('endTurn', this.currentPlayer);
        this.currentAction = null;
        this.selectedShip = null;
        this.showMessage('回合结束', 'info', 2000);
    }

    placeShip(x, y) {
        if (!this.selectedShip) {
            this.showMessage('请先选择要放置的船只', 'warning', 2000);
            return;
        }

        this.socket.emit('placeShip', {
            shipId: this.selectedShip,
            x: x,
            y: y,
            direction: 'horizontal'
        });
    }

    updateTurnIndicator(turn) {
        const turnElement = document.getElementById('turn-indicator');
        if (turnElement) {
            turnElement.textContent = `当前回合: ${turn}`;
        }
    }

    showDiceResult(value) {
        const diceElement = document.getElementById('dice-result');
        const diceValue = document.getElementById('dice-value');

        diceValue.textContent = value;
        diceElement.style.display = 'block';

        setTimeout(() => {
            diceElement.style.display = 'none';
        }, 2000);
    }

    showExplosionAnimation(x, y, attackPower) {
        const board = document.getElementById('board');
        if (!board) return;

        const explosionElement = document.createElement('img');
        explosionElement.src = attackPower > 0 ? '/boom.gif' : '/miss.gif';
        explosionElement.className = 'explosion-animation';

        explosionElement.style.position = 'absolute';
        explosionElement.style.width = '120px';
        explosionElement.style.height = '120px';
        explosionElement.style.pointerEvents = 'none';
        explosionElement.style.zIndex = '100';

        const cellSize = 40;
        const offsetX = x * cellSize + cellSize / 2 - 60;
        const offsetY = y * cellSize + cellSize / 2 - 60;

        explosionElement.style.left = `${offsetX}px`;
        explosionElement.style.top = `${offsetY}px`;

        board.appendChild(explosionElement);

        setTimeout(() => {
            if (explosionElement.parentElement) {
                explosionElement.remove();
            }
        }, 1200);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.game = new BattleshipGame();

    const joinButtons = document.createElement('div');
    joinButtons.innerHTML = `
        <div style="text-align: center; margin: 20px;">
            <button onclick="joinGame('red')" style="padding: 15px 30px; background: #FF4444; color: white; border: none; border-radius: 5px; margin: 10px; cursor: pointer;">加入红方</button>
            <button onclick="joinGame('blue')" style="padding: 15px 30px; background: #4444FF; color: white; border: none; border-radius: 5px; margin: 10px; cursor: pointer;">加入蓝方</button>
        </div>
    `;
    document.getElementById('header').appendChild(joinButtons);
});

function joinGame(color) {
    window.game.currentPlayer = color;
    window.game.socket.emit('joinGame', color);
    const header = document.getElementById('header');
    if (header) {
        header.classList.remove('red', 'blue');
        header.classList.add(color);
    }
    const joinContainer = document.querySelector('div[style*="text-align: center"]');
    if (joinContainer && joinContainer.parentElement) joinContainer.remove();
}
