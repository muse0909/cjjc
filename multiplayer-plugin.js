/**
 * =========================================================
 * 联机大厅插件 8.0 终极纯净版 (Multiplayer Lobby Plugin)
 * 功能：纯净私聊与群聊、AI拉入房间互动
 * 修复：彻底解决加好友、建群一直卡“处理中”或无反应的死锁问题
 * =========================================================
 */

// --- 1. Supabase 配置 ---
const SUPABASE_URL = 'https://ndldvnntwkrppooqzgvx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kbGR2bm50d2tycHBvb3F6Z3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMDU0NTQsImV4cCI6MjA5MDc4MTQ1NH0.MmJIB3MLjxUBABZd7XQnAAKHeNw7WSb_EkI9cu1r52A';

let supabaseClient = null;
let globalPrivateSubscription = null; 
let roomChatSubscription = null; 
let currentMpChatTargetId = null;
let currentIsRoomFlag = false; 
let heartbeatInterval = null;

// 全局聊天记录内存缓存
window.mpChatCache = window.mpChatCache || {};

// 当前拉入房间的 AI 角色
let activeMpCharacter = null;

// 基础屏蔽词库 (保护联机环境)
const BLOCKED_WORDS = ['傻逼', '贱人', '操你妈', '死全家', '尼玛', '智障', '脑残', '煞笔', 'SB', 'sb', '滚蛋', '死妈', '去死'];

function containsBlockedWords(text) {
    for (let word of BLOCKED_WORDS) {
        if (text.toLowerCase().includes(word.toLowerCase())) {
            return true;
        }
    }
    return false;
}

function generateNetworkUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 【新增核心：网络请求超时熔断器】防止 Supabase 挂起导致界面卡死
const withTimeout = (promise, ms = 8000) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('网络请求超时')), ms))
    ]);
};

// ================== 内置弹窗辅助函数 ==================
function mpAlert(msg) {
    if (typeof showAlert === 'function') {
        showAlert(msg);
    } else {
        alert(msg);
    }
}

function mpConfirm(msg, callback) {
    if (typeof showConfirm === 'function') {
        showConfirm(msg, callback);
    } else {
        const res = confirm(msg);
        callback(res);
    }
}

// 【核心修复】：带异步加载状态的丝滑输入弹窗 (防卡死版)
function openMpInputModal(title, placeholder, defaultValue, onConfirm) {
    document.getElementById('mpInputTitle').textContent = title;
    const inputEl = document.getElementById('mpInputValue');
    inputEl.placeholder = placeholder || '';
    inputEl.value = defaultValue || '';
    
    const confirmBtn = document.getElementById('mpInputConfirmBtn');
    
    // 关键修复：克隆按钮节点，彻底清除之前可能残留的旧事件绑定，防止冲突无反应
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    newConfirmBtn.innerHTML = '确定'; 
    newConfirmBtn.disabled = false;   
    
    newConfirmBtn.onclick = async () => {
        const val = inputEl.value.trim();
        if (!val) {
            mpAlert("输入不能为空！");
            return;
        }
        
        // 1. 立即开启“加载中”视觉反馈
        newConfirmBtn.innerHTML = '<i class="ri-loader-4-line fa-spin"></i> 处理中...';
        newConfirmBtn.disabled = true;
        
        try {
            // 2. 等待网络请求完成
            if (onConfirm) {
                await onConfirm(val);
            }
        } catch (e) {
            console.error("弹窗操作失败:", e);
            mpAlert(e.message === '网络请求超时' ? "网络超时，请检查连接或稍后重试" : "操作失败，请重试");
        } finally {
            // 3. 无论成功失败，都必须恢复按钮状态并关闭弹窗
            newConfirmBtn.innerHTML = '确定';
            newConfirmBtn.disabled = false;
            document.getElementById('mpInputModal').classList.remove('show');
        }
    };
    
    document.getElementById('mpInputModal').classList.add('show');
    setTimeout(() => inputEl.focus(), 100);
}

// --- 2. 动态注入 CSS ---
const mpStyles = `
/* 强制导航栏置顶，纯白背景填满状态栏缝隙 */
#multiplayerLobbyScreen .nav-bar,
#multiplayerPrivateChatScreen .nav-bar {
    top: 0 !important;
    padding-top: 30px !important; 
    height: 74px !important;      
    background-color: #ffffff !important;
    border-bottom: 1px solid #f0f0f0 !important;
}

#multiplayerLobbyScreen { background-color: #f7f7f7; }
#multiplayerLobbyScreen .wechat-content {
    padding-top: 74px !important;
    padding-bottom: calc(50px + env(safe-area-inset-bottom)) !important;
    display: flex; flex-direction: column; height: 100%; box-sizing: border-box;
    background-color: #f7f7f7;
}

.mp-bottom-nav {
    position: absolute; bottom: 0; left: 0; right: 0; 
    height: calc(50px + env(safe-area-inset-bottom));
    background: #fff; border-top: 1px solid #eee; display: flex; z-index: 100;
    padding-bottom: env(safe-area-inset-bottom);
}
.mp-tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #999; font-size: 10px; cursor: pointer; transition: color 0.2s;
}
.mp-tab.active { color: #000; font-weight: bold; }
.mp-tab i { font-size: 22px; margin-bottom: 2px; }
.mp-tab:active { transform: scale(0.9); }

.mp-view { flex: 1; display: none; flex-direction: column; overflow: hidden; height: 100%; }
.mp-view.active { display: flex; }

/* 聊天区域滚动与气泡布局 */
.mp-chat-messages { flex: 1; overflow-y: auto; padding: 15px; -webkit-overflow-scrolling: touch; }
.mp-chat-messages .message { display: flex; margin-bottom: 20px; width: 100%; align-items: flex-start; }
.mp-chat-messages .message.sent { justify-content: flex-end; }
.mp-chat-messages .message.received { justify-content: flex-start; }
.mp-chat-messages .message.sent .chat-avatar { order: 2; margin-left: 12px; margin-right: 0; }
.mp-chat-messages .message.received .chat-avatar { order: 0; margin-right: 12px; margin-left: 0; }
.mp-chat-messages .message-body { display: flex; flex-direction: column; max-width: 75%; }
.mp-chat-messages .message.sent .message-body { align-items: flex-end; order: 1; }
.mp-chat-messages .message.received .message-body { align-items: flex-start; order: 1; }

.mp-input-bar {
    display: flex; align-items: center; padding: 10px 15px; background: #fff; border-top: 1px solid #eee; gap: 8px; flex-shrink: 0;
}
.mp-input-bar input {
    flex: 1; background: #f0f2f5; border: none; border-radius: 20px; padding: 10px 15px; font-size: 14px; outline: none;
}
.mp-send-btn {
    width: 36px; height: 36px; background: #000; color: #fff; border: none; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.1s; flex-shrink: 0;
}
.mp-send-btn:active { transform: scale(0.9); }

.mp-ai-reply-btn {
    width: 36px; height: 36px; background: #ccc; color: #fff; border: none; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.3s, transform 0.1s; flex-shrink: 0;
}
.mp-ai-reply-btn:active { transform: scale(0.9); }
.mp-ai-reply-btn.ready { background: #07c160; }

.mp-list-header {
    display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #fff; border-bottom: 1px solid #eee; flex-shrink: 0;
}
.mp-add-btn {
    width: 32px; height: 32px; border-radius: 50%; background: #f5f5f5; color: #000; display: flex; align-items: center; justify-content: center; font-size: 20px; cursor: pointer;
}

#multiplayerPrivateChatScreen { background-color: #f7f7f7; z-index: 2500; display: flex; flex-direction: column; }
#multiplayerPrivateChatScreen .wechat-content {
    flex: 1; display: flex; flex-direction: column; padding-top: 74px !important; padding-bottom: 0 !important; overflow: hidden; height: 100%;
}
#multiplayerPrivateChatScreen .mp-input-bar {
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
}

.mp-action-card {
    background: #f9f9f9; border-radius: 12px; padding: 15px; margin-bottom: 15px;
    display: flex; align-items: center; cursor: pointer; transition: transform 0.1s; border: 1px solid #eee;
}
.mp-action-card:active { transform: scale(0.96); background: #f0f0f0; }
.mp-action-icon { 
    width: 42px; height: 42px; border-radius: 50%; background: #000; color: #fff; 
    display: flex; align-items: center; justify-content: center; font-size: 20px; margin-right: 15px; flex-shrink: 0;
}
.mp-action-text { flex: 1; text-align: left; }
.mp-action-title { font-size: 15px; font-weight: bold; color: #333; margin-bottom: 2px; }
.mp-action-desc { font-size: 11px; color: #999; }
.room-member-row {
    display: flex; align-items: center; padding: 8px 5px; border-bottom: 1px solid #f5f5f5;
}
.room-member-row:last-child { border-bottom: none; }

.ai-name-tag {
    color: #07c160 !important;
    font-weight: bold;
}

.wechat-dark-mode #multiplayerLobbyScreen, .wechat-dark-mode #multiplayerPrivateChatScreen { background-color: #1c1c1e; }
.wechat-dark-mode .mp-bottom-nav, .wechat-dark-mode .mp-input-bar, .wechat-dark-mode .mp-list-header { background: #2c2c2e; border-color: #3a3a3c; }
.wechat-dark-mode .mp-input-bar input { background: #1c1c1e; color: #fff; }
.wechat-dark-mode .mp-tab.active { color: #fff; }
.wechat-dark-mode .mp-add-btn { background: #1c1c1e; color: #fff; }
.wechat-dark-mode .mp-action-card { background: #2c2c2e; border-color: #444; }
.wechat-dark-mode .mp-action-title { color: #fff; }
.wechat-dark-mode .room-member-row { border-bottom-color: #3a3a3c; }
.wechat-dark-mode #multiplayerLobbyScreen .nav-bar, .wechat-dark-mode #multiplayerPrivateChatScreen .nav-bar { background-color: #2c2c2e !important; border-bottom-color: #3a3a3c !important; }
`;

// --- 3. 动态注入 HTML ---
const mpHtml = `
<div id="multiplayerLobbyScreen" class="page">
    <div class="nav-bar">
        <button class="nav-btn" onclick="closeMultiplayerLobby()"><i class="ri-arrow-left-s-line"></i></button>
        <div class="nav-title" id="mpLobbyTitle">消息列表</div>
        <div style="width: 40px;"></div>
    </div>
    
    <div class="wechat-content">
        <!-- 1. 消息列表 -->
        <div id="mp-view-private" class="mp-view active">
            <div class="mp-list-header">
                <span style="font-weight: bold; font-size: 14px; color: #333;">消息列表</span>
                <div class="mp-add-btn" onclick="openRoomActionModal()"><i class="ri-add-line"></i></div>
            </div>
            <div class="mp-chat-messages" id="mpPrivateFriendList" style="padding: 0; background: transparent;"></div>
        </div>

        <!-- 2. 我的名片 -->
        <div id="mp-view-me" class="mp-view" style="padding: 20px; background: transparent; overflow-y: auto;">
            <div class="form-card" style="background:#fff; border-radius:16px; padding:30px 20px; text-align:center; box-shadow:0 4px 15px rgba(0,0,0,0.05); position: relative;">
                <div style="position: absolute; top: 15px; right: 15px; font-size: 12px; color: #07c160; background: #e3f9e9; padding: 4px 8px; border-radius: 12px; font-weight: bold;">● 在线</div>
                <div id="mpMyAvatar" onclick="changeMpAvatar()" style="width:90px; height:90px; border-radius:50%; margin:0 auto 15px; background-size:cover; background-color:#eee; border:2px solid #000; display:flex; align-items:center; justify-content:center; font-size:24px; color:#fff; cursor:pointer;"></div>
                <div id="mpMyName" onclick="changeMpName()" style="font-size: 22px; font-weight: bold; color: #000; cursor:pointer; margin-bottom: 5px;"></div>
                <div style="font-size: 12px; color: #999; margin-bottom: 20px;">点击头像或昵称可修改</div>
                <div style="background: #f5f5f5; border-radius: 12px; padding: 15px; margin-top: 10px;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 5px;">我的专属数字码</div>
                    <div id="mpMyCode" style="font-size: 32px; font-weight: 900; letter-spacing: 5px; color: #000; font-family: monospace;"></div>
                    <div style="font-size: 11px; color: #999; margin-top: 5px;">将数字码发给其他玩家，即可加好友</div>
                </div>
            </div>
        </div>
    </div>

    <div class="mp-bottom-nav">
        <div class="mp-tab active" onclick="switchMpTab('private', this)">
            <i class="ri-message-3-line"></i><span>消息</span>
        </div>
        <div class="mp-tab" onclick="switchMpTab('me', this)">
            <i class="ri-user-smile-line"></i><span>我的</span>
        </div>
    </div>
</div>

<div id="multiplayerPrivateChatScreen" class="page">
    <div class="nav-bar">
        <div style="display: flex; align-items: center;">
            <button class="nav-btn" onclick="closePrivateChat()"><i class="ri-arrow-left-s-line"></i></button>
            <button class="nav-btn" onclick="openPullCharModal()" style="font-size: 20px; margin-left: 5px;" title="拉角色进房间"><i class="ri-robot-line"></i></button>
        </div>
        <div class="nav-title" id="mpPrivateChatTitle">聊天</div>
        <div style="display: flex;">
            <button class="nav-btn" id="mpRoomInfoBtn" onclick="openRoomDetail()" style="display:none;"><i class="ri-group-line"></i></button>
            <button class="nav-btn" onclick="deleteMpFriend()" style="color:#ff3b30; font-size:14px; margin-left: 5px;">退出</button>
        </div>
    </div>
    <div class="wechat-content">
        <div class="mp-chat-messages" id="mpPrivateMessages"></div>
        <div class="mp-input-bar">
            <button class="mp-ai-reply-btn" id="mpAiReplyBtn" onclick="requestMpAiReply()" title="让角色回复" style="display: none;">
                <i class="ri-robot-line"></i>
            </button>
            <input type="text" id="mpPrivateInput" placeholder="发送消息..." onkeydown="if(event.key==='Enter') sendPrivateMessage()">
            <button class="mp-send-btn" onclick="sendPrivateMessage()"><i class="ri-send-plane-fill"></i></button>
        </div>
    </div>
</div>

<!-- 专属内置输入弹窗，告别浏览器原生prompt的卡死 -->
<div id="mpInputModal" class="modal">
    <div class="modal-content">
        <div class="modal-title" id="mpInputTitle">提示</div>
        <input type="text" class="modal-input" id="mpInputValue" placeholder="请输入...">
        <div class="modal-buttons" style="margin-top: 15px;">
            <button class="modal-btn modal-btn-cancel" onclick="document.getElementById('mpInputModal').classList.remove('show')">取消</button>
            <button class="modal-btn modal-btn-confirm" id="mpInputConfirmBtn" style="background:#000; color:#fff;">确定</button>
        </div>
    </div>
</div>

<div id="mpRoomActionModal" class="modal">
    <div class="modal-content" style="padding: 25px 20px;">
        <div class="modal-title" style="margin-bottom: 25px;">添加互动</div>
        
        <div class="mp-action-card" onclick="showAddFriendInput()">
            <div class="mp-action-icon"><i class="ri-user-add-line"></i></div>
            <div class="mp-action-text">
                <div class="mp-action-title">添加好友</div>
                <div class="mp-action-desc">输入 6位数字码 添加私聊好友</div>
            </div>
            <i class="ri-arrow-right-s-line" style="color: #ccc;"></i>
        </div>

        <div class="mp-action-card" onclick="createMpRoom()">
            <div class="mp-action-icon" style="background:#07c160;"><i class="ri-home-heart-line"></i></div>
            <div class="mp-action-text">
                <div class="mp-action-title">创建群聊房间</div>
                <div class="mp-action-desc">生成专属房间号，邀请好友加入</div>
            </div>
            <i class="ri-arrow-right-s-line" style="color: #ccc;"></i>
        </div>

        <div class="mp-action-card" onclick="joinMpRoom()">
            <div class="mp-action-icon" style="background:#1d9bf0;"><i class="ri-login-box-line"></i></div>
            <div class="mp-action-text">
                <div class="mp-action-title">加入群聊房间</div>
                <div class="mp-action-desc">输入 6位房间号 参与群聊</div>
            </div>
            <i class="ri-arrow-right-s-line" style="color: #ccc;"></i>
        </div>

        <div class="modal-buttons" style="margin-top: 25px;">
            <button class="modal-btn modal-btn-cancel" onclick="document.getElementById('mpRoomActionModal').classList.remove('show')">关闭</button>
        </div>
    </div>
</div>

<div id="mpPullCharModal" class="modal">
    <div class="modal-content">
        <div class="modal-title">选择要拉入的角色</div>
        <div style="font-size: 12px; color: #999; margin-bottom: 15px; text-align: center;">
            拉入后，你可以点击左下角绿色按钮让TA发言
        </div>
        <div id="mpLocalCharList" class="multi-select-list" style="max-height: 250px; border: 1px solid #eee; border-radius: 8px; padding: 5px;"></div>
        <div class="modal-buttons" style="margin-top: 15px;">
            <button class="modal-btn modal-btn-cancel" onclick="document.getElementById('mpPullCharModal').classList.remove('show')">取消</button>
        </div>
    </div>
</div>

<div id="mpRoomInviteModal" class="modal">
    <div class="modal-content">
        <div class="modal-title">邀请好友加入房间</div>
        <div id="mpRoomInviteList" class="multi-select-list" style="max-height: 250px;"></div>
        <div class="modal-buttons" style="margin-top: 15px;">
            <button class="modal-btn modal-btn-cancel" onclick="document.getElementById('mpRoomInviteModal').classList.remove('show')">取消</button>
            <button class="modal-btn modal-btn-confirm" onclick="confirmInviteToRoom()">发送邀请</button>
        </div>
    </div>
</div>

<div id="mpRoomDetailModal" class="modal">
    <div class="modal-content">
        <div class="modal-title">房间信息</div>
        <div style="font-size:12px; color:#666; text-align:center; margin-bottom:15px;">房间号: <span id="mpRoomDetailCode" style="font-weight:bold; color:#000; font-size:16px;"></span></div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-weight:bold; font-size:14px;">近期活跃成员</div>
            <button onclick="inviteToRoomModal()" style="background:#000; color:#fff; border:none; padding:4px 10px; border-radius:12px; font-size:12px; cursor:pointer;">+ 邀请好友</button>
        </div>
        
        <div id="mpRoomActiveMembers" style="max-height: 250px; overflow-y: auto; border: 1px solid #f0f0f0; border-radius: 8px; padding: 5px;"></div>
        
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="modal-btn modal-btn-cancel" onclick="document.getElementById('mpRoomDetailModal').classList.remove('show')">关闭</button>
        </div>
    </div>
</div>
`;

(function initMultiplayerPlugin() {
    const styleEl = document.createElement('style');
    styleEl.innerHTML = mpStyles;
    document.head.appendChild(styleEl);
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = mpHtml;
    while(wrapper.firstChild) {
        document.body.appendChild(wrapper.firstChild);
    }
})();

// --- 4. 核心逻辑 ---

function closeMultiplayerLobby() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (globalPrivateSubscription) {
        supabaseClient.removeChannel(globalPrivateSubscription);
        globalPrivateSubscription = null;
    }
    
    if (typeof setActivePage === 'function') {
        setActivePage('wechatApp');
    }
}

function initMpProfile() {
    if (!userProfile.mp) {
        userProfile.mp = {
            mp_id: generateNetworkUUID(),
            code: Math.floor(100000 + Math.random() * 900000).toString(),
            name: userProfile.name || '神秘玩家',
            avatar: userProfile.avatarImage || ''
        };
    } else if (!userProfile.mp.mp_id) {
        userProfile.mp.mp_id = generateNetworkUUID();
    }
    if (!userProfile.mpFriends) userProfile.mpFriends = [];
    if (!userProfile.mpRoomCharacters) userProfile.mpRoomCharacters = {}; 
    if (typeof saveData === 'function') saveData();
}

function initSupabase() {
    if (!window.supabase) {
        mpAlert("网络连接未就绪，请检查网络或刷新页面");
        return false;
    }
    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return true;
}

async function openMultiplayerLobby() {
    initMpProfile();
    if (!initSupabase()) return;
    
    setActivePage('multiplayerLobbyScreen');
    
    updateMpMeView();
    switchMpTab('private', document.querySelector('.mp-tab'));

    await reportOnlineStatus();
    heartbeatInterval = setInterval(reportOnlineStatus, 30000); 

    setupGlobalPrivateListener();
    checkPendingSystemMessages();
}

function setupGlobalPrivateListener() {
    if (globalPrivateSubscription) return; 

    globalPrivateSubscription = supabaseClient.channel(`global_private_${userProfile.mp.mp_id}`)
        .on('postgres_changes', { 
            event: 'INSERT', schema: 'public', table: 'mp_private_messages',
            filter: `receiver_id=eq.${userProfile.mp.mp_id}` 
        }, async payload => {
            const msg = payload.new;
            
            if (msg.content === '[SYSTEM:FRIEND_REQUEST]') {
                const {data: sender} = await supabaseClient.from('mp_users').select('*').eq('id', msg.sender_id).single();
                if (sender) {
                    mpConfirm(`玩家 [${sender.name}] 请求添加你为好友，是否同意？`, (yes) => {
                        if(yes) acceptFriendRequest(sender);
                    });
                }
                return;
            }

            if (msg.content === '[SYSTEM:FRIEND_ACCEPTED]') {
                const {data: sender} = await supabaseClient.from('mp_users').select('*').eq('id', msg.sender_id).single();
                if(sender) {
                    if (!userProfile.mpFriends.some(f => f.id === sender.id)) {
                        userProfile.mpFriends.push({ id: sender.id, name: sender.name, avatar: sender.avatar, code: sender.mp_code, isRoom: false });
                        if(typeof saveData === 'function') await saveData();
                    }
                    renderMpFriendList();
                    if(typeof showToast === 'function') showToast(`[${sender.name}] 已同意你的好友申请`);
                }
                return;
            }

            if (msg.content.startsWith('[SYSTEM:ROOM_INVITE:')) {
                const parts = msg.content.split(':');
                const roomId = parts[2];
                const roomName = parts[3] || '神秘群聊';
                mpConfirm(`好友邀请你加入群聊房间 [${roomName}]，是否加入？`, (yes) => {
                    if(yes) joinMpRoomDirectly(roomId, roomName);
                });
                return;
            }

            const { data: senderInfo } = await supabaseClient.from('mp_users').select('*').eq('id', msg.sender_id).single();
            msg.mp_users = senderInfo || { name: '未知', avatar: 'text:?' };

            if (!window.mpChatCache[msg.sender_id]) window.mpChatCache[msg.sender_id] = [];
            
            // 防重入
            if (!window.mpChatCache[msg.sender_id].some(m => m.id === msg.id)) {
                window.mpChatCache[msg.sender_id].push(msg);
                
                if (!currentIsRoomFlag && currentMpChatTargetId === msg.sender_id) {
                    renderMessageToDOM(msg, document.getElementById('mpPrivateMessages'), false);
                    const container = document.getElementById('mpPrivateMessages');
                    container.scrollTop = container.scrollHeight;
                } else {
                    if (typeof showToast === 'function') showToast(`收到来自 [${senderInfo ? senderInfo.name : '好友'}] 的新消息`);
                }
            }
        }).subscribe();
}

async function checkPendingSystemMessages() {
    const { data } = await supabaseClient
        .from('mp_private_messages')
        .select('*')
        .eq('receiver_id', userProfile.mp.mp_id)
        .like('content', '[SYSTEM:%') 
        .order('created_at', { ascending: false });

    if (data && data.length > 0) {
        const senderIds = [...new Set(data.map(m => m.sender_id))];
        const { data: users } = await supabaseClient.from('mp_users').select('*').in('id', senderIds);
        const userMap = {};
        if (users) users.forEach(u => userMap[u.id] = u);

        const uniqueSenders = new Map();
        data.forEach(req => {
            if (req.content === '[SYSTEM:FRIEND_REQUEST]' && !userProfile.mpFriends.some(f => f.id === req.sender_id)) {
                if(!uniqueSenders.has(req.sender_id) && userMap[req.sender_id]) {
                    uniqueSenders.set(req.sender_id, userMap[req.sender_id]);
                }
            }
        });
        
        // 避免多个弹窗同时覆盖，使用队列依序弹出
        const senderArray = Array.from(uniqueSenders.values());
        let currentIndex = 0;
        
        function showNextRequest() {
            if (currentIndex >= senderArray.length) return;
            const sender = senderArray[currentIndex];
            mpConfirm(`【离线消息】玩家 [${sender.name}] 请求添加你为好友，是否同意？`, async (yes) => {
                if(yes) {
                    await acceptFriendRequest(sender);
                }
                currentIndex++;
                setTimeout(showNextRequest, 300);
            });
        }
        showNextRequest();
    }
}

async function acceptFriendRequest(sender) {
    if (!userProfile.mpFriends.some(f => f.id === sender.id)) {
        userProfile.mpFriends.push({ id: sender.id, name: sender.name, avatar: sender.avatar, code: sender.mp_code, isRoom: false });
        if(typeof saveData === 'function') await saveData();
    }
    renderMpFriendList();
    
    await supabaseClient.from('mp_private_messages').insert([{
        sender_id: userProfile.mp.mp_id, 
        receiver_id: sender.id, 
        content: '[SYSTEM:FRIEND_ACCEPTED]'
    }]);
    mpAlert(`已添加 ${sender.name} 为好友！`);
}

// ================== 房间群聊系统 ==================

function openRoomActionModal() {
    document.getElementById('mpRoomActionModal').classList.add('show');
}

function showAddFriendInput() {
    document.getElementById('mpRoomActionModal').classList.remove('show');
    openMpInputModal("添加好友", "请输入对方的 6位 数字码", "", async (code) => {
        if (code === userProfile.mp.code) {
            throw new Error("不能添加自己为好友哦");
        }
        
        // 【关键修复：增加超时熔断，防止转圈卡死】
        const { data, error } = await withTimeout(
            supabaseClient.from('mp_users').select('id, name').eq('mp_code', code).single(),
            8000
        );
        
        if (error || !data) {
            throw new Error("未找到该玩家，请检查号码是否正确！");
        }
        if (userProfile.mpFriends.find(f => f.id === data.id)) {
            throw new Error("你们已经是好友了！");
        }

        // 后台发送申请
        supabaseClient.from('mp_private_messages').insert([{
            sender_id: userProfile.mp.mp_id, receiver_id: data.id, content: '[SYSTEM:FRIEND_REQUEST]'
        }]).catch(err => console.error("后台发送申请异常:", err));

        setTimeout(() => {
            mpAlert(`已向 [${data.name}] 发送好友申请！\n请让对方在联机大厅同意您的申请。`);
        }, 100);
    });
}

function createMpRoom() {
    document.getElementById('mpRoomActionModal').classList.remove('show');
    openMpInputModal("创建群聊房间", "给群聊起个名字吧", "联机轰趴馆", async (roomName) => {
        if (containsBlockedWords(roomName)) {
            throw new Error("群名包含敏感词，请修改！");
        }

        const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
        const roomId = 'room_' + roomCode; 

        try {
            // 【关键修复：包裹在 try-catch 中，保证安全执行】
            supabaseClient.from('mp_users').upsert({
                id: roomId, name: roomName, mp_code: roomId, avatar: '群', last_seen: new Date().toISOString()
            }).catch(err => console.error("后台建群异常:", err));

            userProfile.mpFriends.unshift({ id: roomId, name: roomName, avatar: '群', code: roomCode, isRoom: true });
            
            if(typeof saveData === 'function') saveData(); 
            
            renderMpFriendList();
            
            setTimeout(() => {
                mpAlert(`群聊 [${roomName}] 创建成功！\n房间号码是: ${roomCode}\n快把号码发给朋友让他们加入吧！`);
            }, 100);
        } catch (e) {
            throw new Error("创建群聊时发生本地错误");
        }
    });
}

function joinMpRoom() {
    document.getElementById('mpRoomActionModal').classList.remove('show');
    openMpInputModal("加入群聊", "请输入 6位 群聊号码", "", async (code) => {
        if (code.length !== 6) {
            throw new Error("请输入正确的 6位 房间号码");
        }

        const roomId = 'room_' + code;
        if (userProfile.mpFriends.find(f => f.id === roomId)) {
            throw new Error("你已经在该群聊里了！");
        }

        // 【关键修复：增加超时熔断，防止转圈卡死】
        const { data, error } = await withTimeout(
            supabaseClient.from('mp_users').select('id, name').eq('id', roomId).single(),
            8000
        );
        
        if (error || !data) {
            throw new Error("未找到该群聊房间，请检查号码是否正确！");
        }

        joinMpRoomDirectly(data.id, data.name);
    });
}

function joinMpRoomDirectly(roomId, roomName) {
    if (!userProfile.mpFriends.find(f => f.id === roomId)) {
        userProfile.mpFriends.unshift({ id: roomId, name: roomName, avatar: '群', code: roomId.replace('room_', ''), isRoom: true });
        if(typeof saveData === 'function') saveData();
        renderMpFriendList();
        mpAlert(`已成功加入群聊 [${roomName}]！`);
    }
}

function inviteToRoomModal() {
    const list = document.getElementById('mpRoomInviteList');
    list.innerHTML = '';
    const realFriends = userProfile.mpFriends.filter(f => !f.isRoom);
    
    if (realFriends.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align:center; color:#999;">没有可邀请的好友</div>';
    } else {
        realFriends.forEach(f => {
            const item = document.createElement('div');
            item.className = 'multi-select-item';
            item.innerHTML = `<input type="checkbox" value="${f.id}" id="inv-${f.id}"><label for="inv-${f.id}">${f.name}</label>`;
            list.appendChild(item);
        });
    }
    document.getElementById('mpRoomInviteModal').classList.add('show');
}

async function confirmInviteToRoom() {
    const room = userProfile.mpFriends.find(f => f.id === currentMpChatTargetId);
    if (!room || !room.isRoom) return;

    const selected = [];
    document.querySelectorAll('#mpRoomInviteList input:checked').forEach(cb => selected.push(cb.value));
    if (selected.length === 0) return mpAlert("请选择好友");

    for (const friendId of selected) {
        await supabaseClient.from('mp_private_messages').insert([{
            sender_id: userProfile.mp.mp_id, receiver_id: friendId, content: `[SYSTEM:ROOM_INVITE:${room.id}:${room.name}]`
        }]);
    }
    document.getElementById('mpRoomInviteModal').classList.remove('show');
    if(typeof showToast === 'function') showToast("邀请已发送");
}

async function openRoomDetail() {
    const room = userProfile.mpFriends.find(f => f.id === currentMpChatTargetId);
    if(!room || !room.isRoom) return;

    document.getElementById('mpRoomDetailCode').textContent = room.code;
    const memberContainer = document.getElementById('mpRoomActiveMembers');
    memberContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#999;"><i class="ri-loader-4-line fa-spin"></i> 读取中...</div>';
    document.getElementById('mpRoomDetailModal').classList.add('show');

    try {
        // 【关键修复：为加载活跃成员增加超时熔断】
        const { data } = await withTimeout(
            supabaseClient.from('mp_private_messages')
                .select('sender_id')
                .eq('receiver_id', room.id)
                .order('created_at', { ascending: false })
                .limit(100),
            8000
        );

        memberContainer.innerHTML = '';
        if (data && data.length > 0) {
            const senderIds = [...new Set(data.map(m => m.sender_id))];
            const { data: users } = await supabaseClient.from('mp_users').select('*').in('id', senderIds);
            const userMap = {};
            if (users) users.forEach(u => userMap[u.id] = u);

            const uniqueMembers = new Map();
            data.forEach(msg => {
                if (userMap[msg.sender_id] && !uniqueMembers.has(msg.sender_id)) {
                    uniqueMembers.set(msg.sender_id, userMap[msg.sender_id]);
                }
            });
            
            if (!uniqueMembers.has(userProfile.mp.mp_id)) {
                uniqueMembers.set(userProfile.mp.mp_id, {name: userProfile.mp.name, avatar: userProfile.mp.avatar || userProfile.mp.name[0]});
            }

            uniqueMembers.forEach((info, id) => {
                const isImg = info.avatar && (info.avatar.startsWith('data:') || info.avatar.startsWith('http'));
                const avatarStyle = isImg ? `background-image:url('${info.avatar}')` : `background:#333; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;`;
                const avatarContent = isImg ? '' : (info.avatar ? info.avatar.replace('text:','') : info.name[0]);
                
                const el = document.createElement('div');
                el.className = 'room-member-row';
                el.innerHTML = `
                    <div style="width:36px; height:36px; border-radius:50%; background-size:cover; ${avatarStyle}; margin-right:10px;">${avatarContent}</div>
                    <div style="font-size:14px; font-weight:bold; color:#333;">${info.name} ${id===userProfile.mp.mp_id?'<span style="color:#07c160; font-size:10px; margin-left:5px;">(我)</span>':''}</div>
                `;
                memberContainer.appendChild(el);
            });
        } else {
            memberContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#999;">暂无活跃成员</div>';
        }
    } catch (e) {
        memberContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:red;">加载超时，请检查网络连接</div>';
    }
}

// ================== 拉角色与AI互动逻辑 ==================

function openPullCharModal() {
    if (!currentIsRoomFlag) {
        mpAlert("只有在群聊房间里才能拉入角色哦！");
        return;
    }

    if (activeMpCharacter) {
        mpAlert(`你已经在这个房间拉入了角色 [${activeMpCharacter.name}]，每个房间只能带一位角色哦！`);
        return;
    }

    const list = document.getElementById('mpLocalCharList');
    list.innerHTML = '';
    
    const localAis = (typeof friends !== 'undefined' ? friends : []).filter(f => !f.isGroup);

    if (localAis.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align:center; color:#999;">你的列表里还没有AI角色哦</div>';
    } else {
        localAis.forEach(f => {
            const item = document.createElement('div');
            item.className = 'room-member-row';
            item.style.cursor = 'pointer';
            item.onclick = () => confirmPullChar(f.id);

            const isImg = f.avatarImage && f.avatarImage.startsWith('data:');
            const avatarStyle = isImg ? `background-image:url('${f.avatarImage}')` : `background:#333; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;`;
            const avatarContent = isImg ? '' : (f.avatar || f.name[0]);

            item.innerHTML = `
                <div style="width:36px; height:36px; border-radius:6px; background-size:cover; ${avatarStyle}; margin-right:10px;">${avatarContent}</div>
                <div style="font-size:14px; font-weight:bold; color:#333; flex:1;">${f.remark || f.name}</div>
                <i class="ri-add-circle-fill" style="color:#07c160; font-size: 20px;"></i>
            `;
            list.appendChild(item);
        });
    }
    
    document.getElementById('mpPullCharModal').classList.add('show');
}

function confirmPullChar(charId) {
    const char = friends.find(f => f.id === charId);
    if (!char) return;

    activeMpCharacter = char;
    
    if (!userProfile.mpRoomCharacters) userProfile.mpRoomCharacters = {};
    userProfile.mpRoomCharacters[currentMpChatTargetId] = char.id;
    if (typeof saveData === 'function') saveData();

    const aiBtn = document.getElementById('mpAiReplyBtn');
    if (aiBtn) {
        aiBtn.classList.add('ready');
    }

    document.getElementById('mpPullCharModal').classList.remove('show');
    
    sendMpSystemMessage(`[SYSTEM_MSG] 玩家 [${userProfile.mp.name}] 将角色 [${char.name}] 拉入了房间！大家快来打招呼吧。`);
    
    if (typeof showToast === 'function') {
        showToast(`已成功让 ${char.name} 加入！点击底部绿色按钮发言。`);
    }
}

async function sendMpSystemMessage(text) {
    if (!currentMpChatTargetId) return;
    
    const sysMsg = {
        sender_id: userProfile.mp.mp_id, 
        receiver_id: currentMpChatTargetId, 
        content: text
    };
    
    await supabaseClient.from('mp_private_messages').insert([sysMsg]);
}

async function requestMpAiReply() {
    if (!currentIsRoomFlag) return mpAlert("只能在群聊房间中呼叫角色！");
    if (!activeMpCharacter) return mpAlert("请先点击右上角机器人图标拉入一个角色！");

    const btn = document.getElementById('mpAiReplyBtn');
    if (btn.disabled) return;

    const targetId = currentMpChatTargetId;

    const msgs = window.mpChatCache[targetId] || [];
    
    const historyText = msgs.slice(-20).map(m => {
        let sName = m.mp_users?.name || '未知玩家';
        let c = m.content;
        
        if (c.startsWith('[AI:')) {
            const match = c.match(/^\[AI:(.+?)\|(.+?)\]([\s\S]*)/);
            if (match) { 
                let parsedName = match[1];
                if (parsedName === activeMpCharacter.name) {
                    sName = "【你自己】";
                } else {
                    sName = parsedName + " (其他人的AI)"; 
                }
                c = match[3]; 
            }
        } else if (c.startsWith('[SYSTEM_MSG]')) {
            sName = "系统提示";
            c = c.replace('[SYSTEM_MSG]', '').trim();
        } else {
            if (m.sender_id === userProfile.mp.mp_id) {
                sName = userProfile.mp.name + " (我的主人)";
            } else {
                sName = sName + " (主人的朋友)";
            }
        }
        return `${sName}: "${c}"`;
    }).join('\n');

    let settings;
    try {
        settings = await dbManager.get('apiSettings', 'settings');
        if (!settings || !settings.apiUrl) throw new Error("API 未配置");
    } catch(e) {
        return mpAlert("请先在主设置中配置 API Key！");
    }

    const prompt = `
【场景定位】：这是一个多人在线的网络群聊房间。大家在自由聊天，气氛轻松。
【你的身份】："${activeMpCharacter.name}" (人设：${activeMpCharacter.role})。
【群员认知】：
1. 玩家 "${userProfile.mp.name}" 是把你拉进群的“主人”。
2. 群里其他人都是你主人的网友，或者网友带进来的其他AI。
3. 聊天记录中标记为“【你自己】”的话，都是你之前真实发过的消息，请保持记忆连贯！

【最近20条群聊记录】：
${historyText || '(群里静悄悄的)'}

【【【你的核心任务与思考逻辑 (必须遵守)】】】
1. **纵观全局**：仔细阅读上面的聊天记录，特别是**最后 1 到 2 条消息**！
2. **精准定位**：判断最后说话的人是在跟谁说话？是在艾特你？是在跟你的主人说话？还是在群嘲？
3. **针对性回复**：
   - 如果别人明确叫了你的名字，你必须马上回应他！
   - 如果别人在跟你的主人说话，你可以护主、插嘴或吃瓜。
   - 如果大家在聊一个话题，顺着话题接梗，不要自顾自说。
4. **活人伪装**：不要像客服一样说话！要像个真实的群友，可以带点情绪、口癖，允许发1到6条短消息连发。

【输出铁律】：
必须返回纯净的 JSON 字符串数组，数组里是你要发的文字。绝对不要带 markdown 代码块或其他说明！
示例：["@张三 你说得对", "哈哈哈哈笑死我了"]
`;
    
    btn.innerHTML = '<i class="ri-loader-4-line fa-spin"></i>';
    btn.disabled = true;

    try {
        const response = await fetch(`${settings.apiUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.modelName,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.9
            })
        });

        if (!response.ok) throw new Error("请求失败");
        
        const data = await response.json();
        const contentStr = data.choices[0].message.content;
        
        let replies = [];
        try {
            const jsonMatch = contentStr.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                replies = JSON.parse(jsonMatch[0]);
            } else {
                replies = [contentStr.replace(/["“”]/g, '')];
            }
        } catch (e) {
            replies = [contentStr.replace(/["“”]/g, '')];
        }

        const avatarData = activeMpCharacter.avatarImage || activeMpCharacter.avatar || activeMpCharacter.name[0];

        for (const text of replies) {
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
            
            const aiPayload = `[AI:${activeMpCharacter.name}|${avatarData}]${text}`;
            
            const tempId = 'temp_ai_' + Date.now();
            const tempMsg = {
                id: tempId,
                content: aiPayload,
                sender_id: userProfile.mp.mp_id, 
                mp_users: { name: userProfile.mp.name, avatar: userProfile.mp.avatar || 'text:我' }
            };
            
            if(!window.mpChatCache[targetId]) window.mpChatCache[targetId] = [];
            window.mpChatCache[targetId].push(tempMsg);
            
            if (currentMpChatTargetId === targetId) {
                renderMessageToDOM(tempMsg, document.getElementById('mpPrivateMessages'), true);
                const container = document.getElementById('mpPrivateMessages');
                container.scrollTop = container.scrollHeight;
            }

            await supabaseClient.from('mp_private_messages').insert([{
                sender_id: userProfile.mp.mp_id,
                receiver_id: targetId,
                content: aiPayload
            }]);
        }

    } catch(e) {
        console.error(e);
        mpAlert("AI角色回复失败: " + e.message);
    } finally {
        btn.innerHTML = '<i class="ri-wechat-line"></i>';
        btn.disabled = false;
    }
}


// ================== 基础功能：切换 Tab、发送消息等 ==================

function switchMpTab(tab, el) {
    document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    
    document.querySelectorAll('.mp-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`mp-view-${tab}`).classList.add('active');

    const titleEl = document.getElementById('mpLobbyTitle');
    if (tab === 'private') {
        titleEl.textContent = '消息列表';
        renderMpFriendList();
    }
    else if (tab === 'me') {
        titleEl.textContent = '我的名片';
        updateMpMeView();
    }
}

function renderMpFriendList() {
    const container = document.getElementById('mpPrivateFriendList');
    container.innerHTML = '';

    if (!userProfile.mpFriends || userProfile.mpFriends.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:50px 20px; color:#999;"><i class="ri-user-search-line" style="font-size:40px; opacity:0.5;"></i><p style="margin-top:10px;">暂无会话</p><p style="font-size:12px;">点击右上角 + 号添加好友或建群</p></div>';
        return;
    }

    userProfile.mpFriends.forEach(f => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; align-items:center; padding: 15px; border-bottom: 1px solid #f9f9f9; cursor: pointer;';
        item.onclick = () => openPrivateChat(f.id, f.name, f.isRoom);

        let avatarStyle = '';
        let avatarContent = '';
        if (f.avatar && (f.avatar.startsWith('data:image') || f.avatar.startsWith('http'))) {
            avatarStyle = `background-image: url('${f.avatar}'); background-size: cover;`;
        } else {
            avatarStyle = `background-color: ${f.isRoom ? '#07c160' : '#333'}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold;`;
            avatarContent = f.avatar ? f.avatar.replace('text:', '') : (f.name ? f.name[0] : '?');
        }

        item.innerHTML = `
            <div style="width:45px; height:45px; border-radius:${f.isRoom ? '10px' : '50%'}; ${avatarStyle}; flex-shrink:0;">${avatarContent}</div>
            <div style="flex:1; margin-left: 12px; display:flex; flex-direction:column; justify-content:center;">
                <div style="font-size:15px; font-weight:bold; color:#000; margin-bottom:2px;">${f.name}</div>
                <div style="font-size:12px; color:#999;">${f.isRoom ? '群号' : '数字码'}: ${f.code}</div>
            </div>
            <i class="ri-arrow-right-s-line" style="color:#ccc; font-size:18px;"></i>
        `;
        container.appendChild(item);
    });
}

function updateMpMeView() {
    const myAvatarEl = document.getElementById('mpMyAvatar');
    if (userProfile.mp.avatar) {
        myAvatarEl.style.backgroundImage = `url(${userProfile.mp.avatar})`;
        myAvatarEl.textContent = '';
    } else {
        myAvatarEl.style.backgroundImage = 'none';
        myAvatarEl.textContent = userProfile.mp.name[0];
    }
    document.getElementById('mpMyName').textContent = userProfile.mp.name;
    document.getElementById('mpMyCode').textContent = userProfile.mp.code;
}

function changeMpName() {
    openMpInputModal("修改大厅昵称", "请输入新的大厅昵称", userProfile.mp.name, async (newName) => {
        if (newName && newName.trim()) {
            if (containsBlockedWords(newName)) throw new Error("昵称包含敏感词，请修改！");
            userProfile.mp.name = newName.trim();
            updateMpMeView();
            if(typeof saveData === 'function') await saveData();
            reportOnlineStatus();
        }
    });
}

function changeMpAvatar() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                let dataUrl = '';
                if (typeof compressImage === 'function') {
                    dataUrl = await compressImage(file, { quality: 0.8, maxWidth: 300 });
                } else {
                    dataUrl = await new Promise((res) => {
                        const r = new FileReader();
                        r.onload = (ev) => res(ev.target.result);
                        r.readAsDataURL(file);
                    });
                }
                userProfile.mp.avatar = dataUrl;
                updateMpMeView();
                if(typeof saveData === 'function') await saveData();
                reportOnlineStatus(); 
            } catch (err) { mpAlert("图片处理失败"); }
        }
    };
    input.click();
}

async function reportOnlineStatus() {
    const avatarData = userProfile.mp.avatar || 'text:' + userProfile.mp.name[0];
    await supabaseClient.from('mp_users').upsert({
        id: userProfile.mp.mp_id, 
        name: userProfile.mp.name,
        avatar: avatarData,
        mp_code: userProfile.mp.code, 
        last_seen: new Date().toISOString()
    });
}

// ================== 【秒开缓存】发送与接收 ==================

async function openPrivateChat(targetId, targetName, isRoom = false) {
    currentMpChatTargetId = targetId;
    currentIsRoomFlag = isRoom; 
    document.getElementById('mpPrivateChatTitle').textContent = targetName;
    document.getElementById('mpRoomInfoBtn').style.display = isRoom ? 'block' : 'none'; 
    
    if (isRoom) {
        if (!userProfile.mpRoomCharacters) userProfile.mpRoomCharacters = {};
        const savedCharId = userProfile.mpRoomCharacters[targetId];
        if (savedCharId) {
            activeMpCharacter = (typeof friends !== 'undefined' ? friends : []).find(f => f.id === savedCharId) || null;
        } else {
            activeMpCharacter = null;
        }
    } else {
        activeMpCharacter = null;
    }

    const aiBtn = document.getElementById('mpAiReplyBtn');
    aiBtn.style.display = isRoom ? 'flex' : 'none';
    if (isRoom && activeMpCharacter) {
        aiBtn.classList.add('ready');
    } else {
        aiBtn.classList.remove('ready');
    }

    setActivePage('multiplayerPrivateChatScreen');
    
    const container = document.getElementById('mpPrivateMessages');
    const cacheKey = targetId;

    if (window.mpChatCache[cacheKey]) {
        container.innerHTML = '';
        window.mpChatCache[cacheKey].forEach(msg => {
            renderMessageToDOM(msg, container, msg.sender_id === userProfile.mp.mp_id);
        });
        container.scrollTop = container.scrollHeight;
    } else {
        container.innerHTML = '<div style="text-align: center; padding:20px; color:#ccc;"><i class="ri-loader-4-line fa-spin"></i> 正在拉取消息...</div>';
    }

    let query = supabaseClient.from('mp_private_messages').select('*');
    if (isRoom) {
        query = query.eq('receiver_id', targetId);
    } else {
        query = query.or(`and(sender_id.eq.${userProfile.mp.mp_id},receiver_id.eq.${targetId}),and(sender_id.eq.${targetId},receiver_id.eq.${userProfile.mp.mp_id})`);
    }

    try {
        const { data } = await withTimeout(query.order('created_at', { ascending: false }).limit(50), 8000);
            
        if (data && data.length > 0) {
            const senderIds = [...new Set(data.map(m => m.sender_id))];
            const { data: users } = await supabaseClient.from('mp_users').select('*').in('id', senderIds);
            const userMap = {};
            if (users) users.forEach(u => userMap[u.id] = u);

            const msgs = data.reverse().filter(m => !m.content.startsWith('[SYSTEM:')); 
            
            const localCache = window.mpChatCache[cacheKey];
            if (!localCache || localCache.length !== msgs.length || localCache[localCache.length-1].id !== msgs[msgs.length-1].id) {
                
                msgs.forEach(msg => {
                    msg.mp_users = userMap[msg.sender_id] || { name: '未知', avatar: 'text:?' }; 
                });

                const pendingTempMsgs = (localCache || []).filter(m => String(m.id).startsWith('temp_'));
                
                const finalMsgs = [...msgs, ...pendingTempMsgs];

                window.mpChatCache[cacheKey] = finalMsgs; 
                
                container.innerHTML = ''; 
                finalMsgs.forEach(msg => {
                    renderMessageToDOM(msg, container, msg.sender_id === userProfile.mp.mp_id);
                });
                container.scrollTop = container.scrollHeight;
            }
        } else if (!window.mpChatCache[cacheKey] || window.mpChatCache[cacheKey].length === 0) {
            window.mpChatCache[cacheKey] = [];
            container.innerHTML = '<div style="text-align: center; padding:20px; color:#ccc;">暂无消息，来打个招呼吧！</div>';
        }
    } catch (err) {
        if (!window.mpChatCache[cacheKey] || window.mpChatCache[cacheKey].length === 0) {
            container.innerHTML = '<div style="text-align: center; padding:20px; color:red;">网络请求超时或失败，请检查网络连接</div>';
        }
    }

    if (roomChatSubscription) supabaseClient.removeChannel(roomChatSubscription);
    if (isRoom) {
        roomChatSubscription = supabaseClient.channel(`chat_room_${targetId}_${Date.now()}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mp_private_messages', filter: `receiver_id=eq.${targetId}` }, async payload => {
                const msg = payload.new;
                
                if (msg.sender_id === userProfile.mp.mp_id) return;

                const { data: senderInfo } = await supabaseClient.from('mp_users').select('*').eq('id', msg.sender_id).single();
                msg.mp_users = senderInfo || { name: '未知', avatar: 'text:?' };
                
                if(!window.mpChatCache[targetId]) window.mpChatCache[targetId] = [];
                
                if (!window.mpChatCache[targetId].some(m => m.id === msg.id)) {
                    window.mpChatCache[targetId].push(msg);

                    if (currentMpChatTargetId === targetId) {
                        renderMessageToDOM(msg, document.getElementById('mpPrivateMessages'), false);
                        document.getElementById('mpPrivateMessages').scrollTop = document.getElementById('mpPrivateMessages').scrollHeight;
                    }
                }
            }).subscribe();
    }
}

function closePrivateChat() {
    currentMpChatTargetId = null;
    currentIsRoomFlag = false;
    activeMpCharacter = null;
    if (roomChatSubscription) {
        supabaseClient.removeChannel(roomChatSubscription);
        roomChatSubscription = null;
    }
    setActivePage('multiplayerLobbyScreen');
    
    const tab = document.querySelector('.mp-tab[onclick*="private"]');
    if (tab) switchMpTab('private', tab);
}

async function sendPrivateMessage() {
    const input = document.getElementById('mpPrivateInput');
    const text = input.value.trim();
    if (!text || !currentMpChatTargetId) return;
    
    if (containsBlockedWords(text)) {
        mpAlert("抱歉，您的消息包含违规词汇，无法发送！");
        return;
    }

    input.value = '';
    
    const targetId = currentMpChatTargetId;
    
    const tempId = 'temp_' + Date.now();
    const tempMsg = {
        id: tempId,
        content: text,
        sender_id: userProfile.mp.mp_id,
        mp_users: { name: userProfile.mp.name, avatar: userProfile.mp.avatar || 'text:'+userProfile.mp.name[0] }
    };
    
    if(!window.mpChatCache[targetId]) window.mpChatCache[targetId] = [];
    window.mpChatCache[targetId].push(tempMsg);
    
    if (currentMpChatTargetId === targetId) {
        renderMessageToDOM(tempMsg, document.getElementById('mpPrivateMessages'), true);
        document.getElementById('mpPrivateMessages').scrollTop = document.getElementById('mpPrivateMessages').scrollHeight;
    }

    try {
        const { data, error } = await withTimeout(
            supabaseClient.from('mp_private_messages').insert([{
                sender_id: userProfile.mp.mp_id, 
                receiver_id: targetId, 
                content: text
            }]).select('*').single(),
            8000
        );

        if (data) {
            data.mp_users = { name: userProfile.mp.name, avatar: userProfile.mp.avatar || 'text:'+userProfile.mp.name[0] };
            
            const cache = window.mpChatCache[targetId];
            if (cache) {
                const idx = cache.findIndex(m => m.id === tempId);
                if (idx > -1) {
                    cache[idx] = data;
                }
            }
        }
        if (error) console.error("发送失败:", error);
    } catch (e) {
        console.error("发送超时或失败:", e);
        mpAlert("消息发送失败，请检查网络！");
    }
}

function deleteMpFriend() {
    if (!currentMpChatTargetId) return;
    mpConfirm("确定要删除/退出吗？", async (yes) => {
        if(yes) {
            userProfile.mpFriends = userProfile.mpFriends.filter(f => f.id !== currentMpChatTargetId);
            if (window.mpChatCache[currentMpChatTargetId]) {
                delete window.mpChatCache[currentMpChatTargetId];
            }
            if(typeof saveData === 'function') await saveData();
            closePrivateChat();
            renderMpFriendList();
            if(typeof showToast === 'function') showToast("操作成功");
        }
    });
}

/**
 * 渲染消息DOM (支持 AI 前缀解析，AI放左边)
 */
function renderMessageToDOM(msg, container, isMe) {
    const div = document.createElement('div');
    
    let userObj = msg.mp_users || { name: '未知', avatar: 'text:?' };
    let displayContent = msg.content;
    let displayName = userObj.name;
    let displayAvatar = userObj.avatar;
    let isAiMsg = false;

    if (displayContent.startsWith('[SYSTEM_MSG]')) {
        div.className = 'system-message-tip';
        div.style.cssText = "text-align:center; color:#999; font-size:12px; margin: 15px 0; width:100%;";
        div.textContent = displayContent.replace('[SYSTEM_MSG]', '').trim();
        container.appendChild(div);
        return;
    }

    if (displayContent.startsWith('[AI:')) {
        const match = displayContent.match(/^\[AI:(.+?)\|(.+?)\]([\s\S]*)/);
        if (match) {
            displayName = match[1];
            displayAvatar = match[2]; 
            displayContent = match[3];
            isAiMsg = true;
            isMe = false; 
        }
    }

    div.className = `message ${isMe ? 'sent' : 'received'}`;

    const isImg = displayAvatar && (displayAvatar.startsWith('data:image') || displayAvatar.startsWith('http'));
    const avatarStyle = isImg ? `background-image: url('${displayAvatar}'); background-size: cover; border:none;` : `background-color:${isAiMsg?'#07c160':'#333'}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;`;
    const avatarContent = isImg ? '' : (displayAvatar ? displayAvatar.replace('text:', '') : '?');

    const avatarHtml = `<div class="chat-avatar" style="${avatarStyle}">${avatarContent}</div>`;
    
    const nameHtml = !isMe ? `<div class="message-sender-name" style="font-size:11px; color:#999; margin-bottom:4px; margin-left:5px;">${displayName}</div>` : '';
    
    const bubbleBg = isMe ? '#000' : '#fff'; 
    const bubbleColor = isMe ? '#fff' : '#333';
    const bubbleBorder = isMe ? 'none' : '1px solid #eee';
    
    const bodyHtml = `
        <div class="message-body">
            ${nameHtml}
            <div class="message-content" style="background:${bubbleBg}; color:${bubbleColor}; border:${bubbleBorder}; border-radius:12px; padding:10px 14px; box-shadow:0 1px 3px rgba(0,0,0,0.05); width:fit-content; max-width:100%; word-break:break-all;">
                ${displayContent.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '<br>')}
            </div>
        </div>
    `;

    div.innerHTML = `${avatarHtml}${bodyHtml}`;
    container.appendChild(div);
}
