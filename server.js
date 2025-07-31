const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 서빙
app.use(express.static('public'));

// 게임 상태 관리
class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = [];
        this.gameState = {
            started: false,
            ended: false,
            won: false,
            deck: [],
            piles: {
                up1: [1],    // 오름차순 더미 1 (1에서 시작)
                up2: [1],    // 오름차순 더미 2 (1에서 시작)
                down1: [100], // 내림차순 더미 1 (100에서 시작)
                down2: [100]  // 내림차순 더미 2 (100에서 시작)
            },
            cardsRemaining: 0, // 초기값을 0으로 설정
            currentPlayerIndex: 0,
            turnState: {
                cardsPlayedThisTurn: 0,
                minCardsRequired: 2,
                turnInProgress: false
            },
            pileWarnings: {
                up1: [],
                up2: [],
                down1: [],
                down2: []
            },
            pileIntentions: {
                up1: [],
                up2: [],
                down1: [],
                down2: []
            },
            pilePoopEffects: {
                up1: false,
                up2: false,
                down1: false,
                down2: false
            }
        };
        this.initializeDeck();
    }

    initializeDeck() {
        // 2-99까지의 카드 생성
        this.gameState.deck = [];
        for (let i = 2; i <= 99; i++) {
            this.gameState.deck.push(i);
        }
        this.shuffleDeck();
        // 초기 카드 수 설정 (98장)
        this.gameState.cardsRemaining = this.gameState.deck.length;
    }

    shuffleDeck() {
        for (let i = this.gameState.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.gameState.deck[i], this.gameState.deck[j]] = 
            [this.gameState.deck[j], this.gameState.deck[i]];
        }
    }

    addPlayer(playerId, playerName) {
        if (this.players.length >= 6) return { success: false, message: '방이 가득참 (최대 6명)' };
        if (this.gameState.started) return { success: false, message: '이미 진행중인 게임입니다.' };
        
        const player = {
            id: playerId,
            name: playerName,
            hand: [],
            ready: false
        };
        
        this.players.push(player);
        return { success: true };
    }

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        
        if (playerIndex === -1) return { playerRemoved: false };
        
        const wasCurrentPlayer = playerIndex === this.gameState.currentPlayerIndex;
        this.players = this.players.filter(p => p.id !== playerId);
        
        // 현재 플레이어가 나갔다면 턴 조정
        if (wasCurrentPlayer && this.gameState.started && this.players.length > 0) {
            // 현재 플레이어 인덱스가 범위를 벗어나지 않도록 조정
            if (this.gameState.currentPlayerIndex >= this.players.length) {
                this.gameState.currentPlayerIndex = 0;
            }
            // 턴 상태 초기화 (새로운 플레이어의 턴으로)
            this.gameState.turnState.cardsPlayedThisTurn = 0;
            
            // 새로운 플레이어의 패배 조건 체크
            this.checkDefeatCondition();
            
            return { 
                playerRemoved: true, 
                wasCurrentPlayer: true,
                newCurrentPlayer: this.players[this.gameState.currentPlayerIndex]
            };
        } else if (playerIndex < this.gameState.currentPlayerIndex) {
            // 현재 플레이어보다 앞선 인덱스의 플레이어가 나갔다면 현재 플레이어 인덱스 조정
            this.gameState.currentPlayerIndex--;
        }
        
        return { playerRemoved: true, wasCurrentPlayer: false };
    }

    startGame() {
        if (this.players.length < 2) return false;
        
        this.gameState.started = true;
        this.gameState.currentPlayerIndex = 0;
        this.gameState.turnState.turnInProgress = true;
        this.dealCards();
        
        // 게임 시작 직후 패배 조건 체크
        this.checkDefeatCondition();
        
        return true;
    }

    dealCards() {
        // 플레이어 수에 따른 초기 손패 수
        const handSize = this.players.length === 2 ? 7 : 6;
        
        this.players.forEach(player => {
            player.hand = [];
            for (let i = 0; i < handSize; i++) {
                if (this.gameState.deck.length > 0) {
                    player.hand.push(this.gameState.deck.pop());
                }
            }
            player.hand.sort((a, b) => a - b);
        });
        
        // 실제 남은 카드 수 계산
        this.gameState.cardsRemaining = this.gameState.deck.length + 
            this.players.reduce((sum, p) => sum + p.hand.length, 0);
    }

    canPlayCard(card, pileType) {
        const topCard = this.gameState.piles[pileType][this.gameState.piles[pileType].length - 1];
        
        switch (pileType) {
            case 'up1':
            case 'up2':
                return card > topCard || card === topCard - 10;
            case 'down1':
            case 'down2':
                return card < topCard || card === topCard + 10;
            default:
                return false;
        }
    }

    playCard(playerId, card, pileType) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const player = this.players[playerIndex];
        
        if (!player || !player.hand.includes(card)) return { success: false, message: '유효하지 않은 카드입니다.' };
        
        // 현재 플레이어의 턴인지 확인
        if (playerIndex !== this.gameState.currentPlayerIndex) {
            return { success: false, message: '당신의 턴이 아닙니다.' };
        }
        
        if (!this.canPlayCard(card, pileType)) {
            return { success: false, message: '해당 더미에 카드를 놓을 수 없습니다.' };
        }
        
        // 이전 카드 값 저장
        const pile = this.gameState.piles[pileType];
        const previousCard = pile[pile.length - 1];
        
        // 카드 플레이
        player.hand = player.hand.filter(c => c !== card);
        this.gameState.piles[pileType].push(card);
        this.gameState.turnState.cardsPlayedThisTurn++;
        
        // 20 이상 차이나는 카드인지 체크 (똥 이펙트)
        const isPoopMove = Math.abs(card - previousCard) >= 20;
        
        this.updateGameState();
        
        // 카드를 놓은 후 패배 조건 체크
        const isDefeated = this.checkDefeatCondition();
        
        return { 
            success: true, 
            previousCard, 
            isPoopMove,
            isDefeated
        };
    }

    endTurn(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        
        if (playerIndex !== this.gameState.currentPlayerIndex) {
            return { success: false, message: '당신의 턴이 아닙니다.' };
        }
        
        // 최소 카드 수 체크
        const minRequired = this.gameState.deck.length === 0 ? 1 : 2;
        if (this.gameState.turnState.cardsPlayedThisTurn < minRequired) {
            return { success: false, message: `최소 ${minRequired}장의 카드를 놓아야 합니다.` };
        }
        
        // 카드 뽑기 (턴이 끝날 때)
        const player = this.players[playerIndex];
        const cardsToDraw = this.gameState.turnState.cardsPlayedThisTurn;
        
        for (let i = 0; i < cardsToDraw && this.gameState.deck.length > 0; i++) {
            player.hand.push(this.gameState.deck.pop());
        }
        player.hand.sort((a, b) => a - b);
        
        // 다음 플레이어로 턴 넘기기
        this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.players.length;
        this.gameState.turnState.cardsPlayedThisTurn = 0;
        
        this.updateGameState();
        
        // 턴이 넘어간 후 새로운 플레이어의 패배 조건 체크
        const isDefeated = this.checkDefeatCondition();
        
        return { success: true, isDefeated };
    }

    canPlayerEndTurn(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== this.gameState.currentPlayerIndex) return false;
        
        const minRequired = this.gameState.deck.length === 0 ? 1 : 2;
        return this.gameState.turnState.cardsPlayedThisTurn >= minRequired;
    }

    setWarning(playerId, pileType) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const player = this.players[playerIndex];
        
        if (!player) return { success: false, message: '플레이어를 찾을 수 없습니다.' };
        
        const warningArray = this.gameState.pileWarnings[pileType];
        const existingIndex = warningArray.findIndex(w => w.playerId === playerId);
        
        // 기존 경고가 있으면 제거, 없으면 추가
        if (existingIndex !== -1) {
            warningArray.splice(existingIndex, 1);
        } else {
            warningArray.push({ playerId, playerName: player.name });
        }
        
        return { success: true, playerId, pileType, playerName: player.name };
    }

    setIntention(playerId, pileType) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const player = this.players[playerIndex];
        
        if (!player) return { success: false, message: '플레이어를 찾을 수 없습니다.' };
        
        const intentionArray = this.gameState.pileIntentions[pileType];
        const existingIndex = intentionArray.findIndex(i => i.playerId === playerId);
        
        // 기존 의도가 있으면 제거, 없으면 추가
        if (existingIndex !== -1) {
            intentionArray.splice(existingIndex, 1);
        } else {
            intentionArray.push({ playerId, playerName: player.name });
        }
        
        return { success: true, playerId, pileType, playerName: player.name };
    }

    updateGameState() {
        this.gameState.cardsRemaining = this.gameState.deck.length + 
            this.players.reduce((sum, p) => sum + p.hand.length, 0);
        
        // 승리 조건 체크
        if (this.gameState.cardsRemaining === 0) {
            this.gameState.ended = true;
            this.gameState.won = true;
            return;
        }
        
        // 패배 조건 체크는 여기서 하지 않고, 별도 함수에서 처리
    }

    checkDefeatCondition() {
        // 패배 조건 체크 - 현재 낼 수 있는 카드가 없으면서 최소 요구수를 채우지 못한 경우
        if (this.gameState.started && this.players.length > 0 && !this.gameState.ended) {
            const currentPlayer = this.players[this.gameState.currentPlayerIndex];
            
            if (currentPlayer) {
                // 덱에 카드가 남아있으면 최소 2장, 없으면 최소 1장 필요
                const minRequired = this.gameState.deck.length === 0 ? 1 : 2;
                
                // 이번 턴에 이미 놓은 카드 수
                const cardsPlayedThisTurn = this.gameState.turnState.cardsPlayedThisTurn;
                
                // 아직 최소 요구수를 채우지 못했고, 현재 낼 수 있는 카드가 없으면 패배
                if (cardsPlayedThisTurn < minRequired) {
                    const canCurrentPlayerPlay = currentPlayer.hand.some(card => 
                        this.canPlayCard(card, 'up1') || 
                        this.canPlayCard(card, 'up2') || 
                        this.canPlayCard(card, 'down1') || 
                        this.canPlayCard(card, 'down2')
                    );
                    
                    if (!canCurrentPlayerPlay) {
                        this.gameState.ended = true;
                        this.gameState.won = false;
                        return true;
                    }
                }
            }
        }
        return false;
    }

    getGameStateForPlayer(playerId) {
        const player = this.players.find(p => p.id === playerId);
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        
        // 좋은 수 카드 계산 (모든 플레이어에게 항상 계산)
        let goodMoveCards = [];
        if (player) {
            player.hand.forEach(card => {
                Object.keys(this.gameState.piles).forEach(pileType => {
                    const pile = this.gameState.piles[pileType];
                    const topCard = pile[pile.length - 1];
                    
                    // 역방향 10차이 체크
                    if ((pileType === 'up1' || pileType === 'up2') && card === topCard - 10) {
                        goodMoveCards.push(card);
                    } else if ((pileType === 'down1' || pileType === 'down2') && card === topCard + 10) {
                        goodMoveCards.push(card);
                    }
                });
            });
        }
        
        return {
            ...this.gameState,
            players: this.players.map((p, index) => ({
                id: p.id,
                name: p.name,
                handSize: p.hand.length,
                ready: p.ready,
                isCurrentPlayer: index === this.gameState.currentPlayerIndex
            })),
            myHand: player ? player.hand : [],
            isMyTurn: playerIndex === this.gameState.currentPlayerIndex,
            canEndTurn: this.canPlayerEndTurn(playerId),
            currentPlayerName: this.players[this.gameState.currentPlayerIndex]?.name || '',
            goodMoveCards: [...new Set(goodMoveCards)] // 중복 제거
        };
    }
}

// 게임 룸 관리
const gameRooms = new Map();

io.on('connection', (socket) => {
    console.log('플레이어 연결:', socket.id);

    socket.on('joinRoom', (data) => {
        const { roomId, playerName } = data;
        
        if (!gameRooms.has(roomId)) {
            gameRooms.set(roomId, new GameRoom(roomId));
        }
        
        const room = gameRooms.get(roomId);
        
        const result = room.addPlayer(socket.id, playerName);
        
        if (result.success) {
            socket.join(roomId);
            socket.roomId = roomId;
            
            io.to(roomId).emit('gameState', {
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    handSize: p.hand.length,
                    ready: p.ready
                })),
                started: room.gameState.started
            });
            
            socket.emit('joinSuccess', { roomId });
        } else {
            socket.emit('joinFailed', { message: result.message });
        }
    });

    socket.on('playerReady', () => {
        if (!socket.roomId) return;
        
        const room = gameRooms.get(socket.roomId);
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = !player.ready;
            
            io.to(socket.roomId).emit('gameState', {
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    handSize: p.hand.length,
                    ready: p.ready
                })),
                started: room.gameState.started
            });
        }
    });

    socket.on('startGame', () => {
        if (!socket.roomId) return;
        
        const room = gameRooms.get(socket.roomId);
        if (!room) return;
        
        const allReady = room.players.every(p => p.ready);
        if (allReady && room.players.length >= 2) {
            if (room.startGame()) {
                room.players.forEach(player => {
                    io.to(player.id).emit('gameStarted', room.getGameStateForPlayer(player.id));
                });
            }
        }
    });

    socket.on('playCard', (data) => {
        if (!socket.roomId) return;
        
        const room = gameRooms.get(socket.roomId);
        if (!room || !room.gameState.started) return;
        
        const { card, pileType } = data;
        
        const result = room.playCard(socket.id, card, pileType);
        
        if (result.success) {
            // 똥 이펙트 처리 (서버에서 직접 처리하지 않고 클라이언트에게 전달만)
            room.players.forEach(player => {
                io.to(player.id).emit('gameState', room.getGameStateForPlayer(player.id));
            });
            
            io.to(socket.roomId).emit('cardPlayed', {
                playerId: socket.id,
                card,
                previousCard: result.previousCard,
                pileType,
                playerName: room.players.find(p => p.id === socket.id)?.name,
                cardsPlayedThisTurn: room.gameState.turnState.cardsPlayedThisTurn,
                isPoopMove: result.isPoopMove,
                isDefeated: result.isDefeated
            });
        } else {
            socket.emit('invalidMove', { message: result.message });
        }
    });

    socket.on('endTurn', () => {
        if (!socket.roomId) return;
        
        const room = gameRooms.get(socket.roomId);
        if (!room || !room.gameState.started) return;
        
        const result = room.endTurn(socket.id);
        
        if (result.success) {
            room.players.forEach(player => {
                io.to(player.id).emit('gameState', room.getGameStateForPlayer(player.id));
            });
            
            const currentPlayerName = room.players[room.gameState.currentPlayerIndex]?.name;
            io.to(socket.roomId).emit('turnEnded', {
                previousPlayer: room.players.find(p => p.id === socket.id)?.name,
                currentPlayer: currentPlayerName,
                isDefeated: result.isDefeated
            });
        } else {
            socket.emit('invalidMove', { message: result.message });
        }
    });

    socket.on('setWarning', (data) => {
        if (!socket.roomId) return;
        
        const room = gameRooms.get(socket.roomId);
        if (!room || !room.gameState.started) return;
        
        const { pileType } = data;
        const result = room.setWarning(socket.id, pileType);
        
        if (result.success) {
            room.players.forEach(player => {
                io.to(player.id).emit('gameState', room.getGameStateForPlayer(player.id));
            });
            
            io.to(socket.roomId).emit('warningSet', {
                playerId: result.playerId,
                playerName: result.playerName,
                pileType: result.pileType,
                isActive: room.gameState.pileWarnings[pileType].length > 0
            });
        }
    });

    socket.on('setIntention', (data) => {
        if (!socket.roomId) return;
        
        const room = gameRooms.get(socket.roomId);
        if (!room || !room.gameState.started) return;
        
        const { pileType } = data;
        const result = room.setIntention(socket.id, pileType);
        
        if (result.success) {
            room.players.forEach(player => {
                io.to(player.id).emit('gameState', room.getGameStateForPlayer(player.id));
            });
            
            io.to(socket.roomId).emit('intentionSet', {
                playerId: result.playerId,
                playerName: result.playerName,
                pileType: result.pileType,
                isActive: room.gameState.pileIntentions[pileType].length > 0
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('플레이어 연결 해제:', socket.id);
        
        if (socket.roomId) {
            const room = gameRooms.get(socket.roomId);
            if (room) {
                const result = room.removePlayer(socket.id);
                
                if (room.players.length === 0) {
                    gameRooms.delete(socket.roomId);
                } else {
                    // 플레이어 목록 업데이트 전송
                    room.players.forEach(player => {
                        io.to(player.id).emit('gameState', room.getGameStateForPlayer(player.id));
                    });
                    
                    // 현재 플레이어가 나갔다면 턴 변경 알림
                    if (result.wasCurrentPlayer && result.newCurrentPlayer) {
                        io.to(socket.roomId).emit('playerDisconnected', {
                            message: '현재 플레이어가 연결을 해제했습니다.',
                            newCurrentPlayer: result.newCurrentPlayer.name
                        });
                    } else {
                        io.to(socket.roomId).emit('playerDisconnected', {
                            message: '플레이어가 연결을 해제했습니다.'
                        });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});