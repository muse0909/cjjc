/**
 * JRSY 生图插件 (Image Generation Plugin) - 锁脸人设版
 * [优化版 V7] 去除破限、增加多比例尺寸选择、优化垫图体积提速、全屏看图保存
 */

let ImageGenPlugin = {};

(function() {
    let igSettings = {
        enabled: false,
        activeAiIds: [], 
        apiUrl: '',
        apiKey: '',
        modelName: '',
        imageSize: '1024x1024', // 新增：尺寸比例设置
        globalPrompt: ''
    };

    let tempFaceLockImage = ''; 

    function injectPluginUI() {
        if (document.getElementById('imageGenSettingsScreen')) return;

        const screenContainer = document.querySelector('.screen');
        if (!screenContainer) return;

        const style = document.createElement('style');
        style.id = 'image-gen-plugin-style';
        style.textContent = `
            #imageGenSettingsScreen { z-index: 100; }
            .img-gen-hint { font-size: 11px; color: #999; margin-top: 5px; line-height: 1.4; }
            #igImageViewer::-webkit-scrollbar { display: none; }
            
            .wechat-dark-mode #faceLockSettingsModal .modal-content { background-color: #1c1c1e !important; }
            .wechat-dark-mode #faceLockSettingsModal .modal-title { color: #fff !important; }
            .wechat-dark-mode #faceLockSettingsModal .modal-textarea { background-color: #2c2c2e !important; color: #fff !important; border-color: #333 !important; }
            .wechat-dark-mode #faceLockSettingsModal .form-label-title { color: #ddd !important; }
            .wechat-dark-mode #faceLockSettingsModal .avatar-upload { background-color: #2c2c2e !important; border-color: #444 !important; }
            .wechat-dark-mode #faceLockSettingsModal .btn-cancel-bw { background-color: #2c2c2e !important; color: #aaa !important; }
            .wechat-dark-mode #faceLockSettingsModal .btn-confirm-bw { background-color: #fff !important; color: #000 !important; }
            .wechat-dark-mode #faceLockSettingsModal .btn-delete-bw { background-color: #1c1c1e !important; color: #ff453a !important; border-color: #3a3a3c !important; }
            
            #igImageSize { appearance: none; -webkit-appearance: none; direction: rtl; cursor: pointer; color: #333; }
            .wechat-dark-mode #igImageSize { color: #fff; }
            .wechat-dark-mode #igImageSize option { background-color: #2c2c2e; color: #fff; }
        `;
        document.head.appendChild(style);

        const htmlContent = `
        <div id="imageGenSettingsScreen" class="page">
            <div class="nav-bar">
                <button class="nav-btn" onclick="ImageGenPlugin.closeSettings()"><i class="ri-arrow-left-s-line"></i></button>
                <div class="nav-title">生图 API 设置</div>
                <div></div>
            </div>
            
            <div class="settings-content bw-style">
                <div class="form-card">
                    <div class="form-group-row switch-row">
                        <label class="form-label">启用 AI 生图</label>
                        <label class="toggle-switch bw-switch">
                            <input type="checkbox" id="igGlobalToggle" onchange="ImageGenPlugin.toggleGlobal()">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="form-hint" style="margin-bottom: 10px;">开启后，AI决定发送图片时，将调用生图API生成真实图片。可前往好友设置内配置“锁脸图”。</div>
                    
                    <div class="form-group-row clickable" id="igRoleSelectRow" style="display:none;" onclick="ImageGenPlugin.openRoleModal()">
                        <label class="form-label">生效角色</label>
                        <div class="form-value-display">点击选择 <i class="ri-arrow-right-s-line"></i></div>
                    </div>
                </div>

                <div class="form-card">
                    <div class="form-group-row" style="border-bottom: none; padding-bottom: 10px;">
                        <label class="form-label" style="color: #999; font-size: 12px;">独立生图配置 (兼容 DALL-E / SD / 垫图 接口)</label>
                    </div>
                    
                    <div class="form-group-row">
                        <label class="form-label">API 地址</label>
                        <input type="text" class="form-input" id="igApiUrl" placeholder="如: https://api.openai.com/v1">
                    </div>
                    <div class="form-group-row">
                        <label class="form-label">API Key</label>
                        <div style="flex: 1; display: flex; align-items: center;">
                            <input type="password" class="form-input" id="igApiKey" placeholder="sk-...">
                            <i class="ri-close-circle-fill" style="color: #ccc; margin-left: 8px; cursor: pointer; font-size: 18px;" onclick="document.getElementById('igApiKey').value = ''"></i>
                        </div>
                    </div>

                    <div class="form-group-row column-layout" style="align-items: stretch;">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <label class="form-label">生图模型</label>
                            <button class="bw-chip-btn" onclick="ImageGenPlugin.fetchModels()">
                                <i class="ri-download-cloud-2-line"></i> 拉取列表
                            </button>
                        </div>
                        <div class="model-select-container" style="width: 100%; margin-top: 10px; position: relative;">
                            <input type="text" class="form-input" id="igModelName" placeholder="如: dall-e-3 / flux" readonly onclick="ImageGenPlugin.toggleDropdown()" style="background: #f9f9f9; padding: 10px; border-radius: 8px; width: 100%; text-align: left; cursor: pointer;">
                            <span class="select-arrow" onclick="ImageGenPlugin.toggleDropdown()" style="right: 10px; cursor: pointer;">
                                <i class="ri-arrow-down-s-line"></i>
                            </span>
                            <div class="model-dropdown bw-dropdown" id="igModelDropdown"></div>
                        </div>
                    </div>

                    <div class="form-group-row" style="border-bottom: none;">
                        <label class="form-label">图片尺寸 (比例)</label>
                        <select class="form-input" id="igImageSize" style="background: transparent; border: none; padding: 0;">
                            <option value="1024x1024">1:1 (正方形 1024x1024)</option>
                            <option value="768x1024">3:4 (竖屏 768x1024)</option>
                            <option value="1024x768">4:3 (横屏 1024x768)</option>
                            <option value="1024x1792">9:16 (修长竖屏 1024x1792)</option>
                            <option value="1792x1024">16:9 (宽屏 1792x1024)</option>
                        </select>
                    </div>
                </div>

                <div class="form-card">
                    <div class="form-group-row column-layout" style="border-bottom:none;">
                        <label class="form-label">全局正向提示词 (Prompt)</label>
                        <textarea class="form-textarea large-area" id="igGlobalPrompt" style="min-height:80px;" placeholder="例如: 杰作, 极高画质, 真实摄影, 8k..."></textarea>
                        <div class="img-gen-hint">会附加在每次生图画面描述前。角色的外貌锁脸设置需前往对应【好友设置】内填写。</div>
                    </div>
                </div>

                <div class="settings-buttons">
                    <button class="settings-btn btn-black" onclick="ImageGenPlugin.saveSettings()">保存并生效</button>
                </div>
            </div>
        </div>

        <div id="imageGenRoleModal" class="modal" style="z-index: 100000;">
            <div class="modal-content">
                <div class="modal-title">选择允许生图的角色</div>
                <div id="igRoleList" class="multi-select-list" style="max-height: 50vh; overflow-y: auto;"></div>
                <div class="modal-buttons" style="margin-top: 15px;">
                    <button class="modal-btn modal-btn-cancel" onclick="ImageGenPlugin.closeRoleModal()">取消</button>
                    <button class="modal-btn modal-btn-confirm" onclick="ImageGenPlugin.confirmRoles()">确定</button>
                </div>
            </div>
        </div>

        <div id="faceLockSettingsModal" class="modal" style="z-index: 100000;">
            <div class="modal-content" style="background-color: #ffffff; border-radius: 24px; padding: 30px 25px; max-width: 320px; width: 85%; border: none; box-shadow: 0 10px 40px rgba(0,0,0,0.15);">
                <div class="modal-title" style="font-size: 18px; font-weight: 700; color: #000; text-align: center; margin-bottom: 15px; border-bottom: none;">
                    外貌与锁脸设置
                </div>
                
                <div style="font-size: 12px; color: #999; text-align: center; line-height: 1.5; margin-bottom: 20px;">
                    提供详细特征或上传参考图垫图，尽可能固定角色的长相。<br>
                    <b style="color:#ff3b30; display:block; margin-top:5px;">注：由于技术原因（各大模型的垫图权重和指令理解差异），不能完全保证生成的每一张脸都100%一模一样。</b>
                </div>

                <div class="form-group" style="margin-bottom: 20px;">
                    <label class="form-label-title" style="display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 8px;">外貌提示词 (Prompt)</label>
                    <textarea class="modal-textarea" id="faceLockPromptInput" placeholder="例如：一个20岁的亚洲混血女孩，冷白皮，瓜子脸，下垂眼，泪痣，黑色长直发，五官精致立体..." style="background-color: #f7f7f7; border: 1px solid transparent; border-radius: 12px; padding: 14px 16px; font-size: 14px; color: #333; width: 100%; box-sizing: border-box; min-height: 100px; resize: none;"></textarea>
                </div>

                <div class="form-group" style="margin-bottom: 20px;">
                    <label class="form-label-title" style="display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 8px;">人脸参考图 (图生图)</label>
                    <div class="avatar-upload" id="faceLockImageUpload" onclick="document.getElementById('faceLockImageFileInput').click()" style="width: 100%; height: 120px; border-radius: 12px; margin: 0; background-size: contain; background-repeat: no-repeat; background-position: center; background-color: #f7f7f7; border: 2px dashed #e5e5e5; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;">
                        <input type="file" id="faceLockImageFileInput" accept="image/*" style="display: none;" onchange="ImageGenPlugin.handleFaceLockImageUpload(event)">
                        <span id="faceLockImagePreview" style="font-size: 30px; color: #ccc;">+</span>
                    </div>
                </div>

                <div class="modal-buttons" style="display: flex; gap: 12px; margin-top: 10px;">
                    <button class="btn-cancel-bw" onclick="ImageGenPlugin.closeFaceLockModal()" style="flex: 1; height: 44px; border-radius: 22px; font-size: 15px; font-weight: 600; cursor: pointer; background-color: #f0f0f0; color: #666; border: none; transition: transform 0.1s;">取消</button>
                    <button class="btn-confirm-bw" onclick="ImageGenPlugin.saveFaceLockSettings()" style="flex: 1; height: 44px; border-radius: 22px; font-size: 15px; font-weight: 600; cursor: pointer; background-color: #000; color: #fff; border: none; box-shadow: 0 4px 10px rgba(0,0,0,0.2); transition: transform 0.1s;">保存</button>
                </div>
                
                <button class="settings-btn btn-delete-bw" style="background-color: #ffffff; color: #ff3b30; border: 1px solid #e5e5e5; border-radius: 30px; height: 44px; font-weight: 500; font-size: 15px; width: 100%; cursor: pointer; margin-top: 15px; transition: background-color 0.2s;" onclick="ImageGenPlugin.clearFaceLockSettings()">清除锁脸数据</button>
            </div>
        </div>
        `;
        screenContainer.insertAdjacentHTML('beforeend', htmlContent);

        const viewerHtml = `
        <div id="igImageViewer" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:999999; flex-direction:column; align-items:center; justify-content:center; backdrop-filter: blur(5px);">
            <div style="position: absolute; top: 30px; right: 25px; color: #fff; font-size: 32px; cursor: pointer; z-index: 10;" onclick="document.getElementById('igImageViewer').style.display='none'"><i class="ri-close-line"></i></div>
            <img id="igImageViewerImg" style="max-width:95%; max-height:75%; object-fit:contain; border-radius:12px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
            <div style="margin-top: 40px; display:flex; gap: 20px;">
                <button id="igSaveImageBtn" style="padding:14px 40px; background:#fff; color:#000; border:none; border-radius:30px; font-weight:800; font-size: 16px; cursor:pointer; box-shadow: 0 4px 15px rgba(255,255,255,0.2); transition: transform 0.1s;">保存图片</button>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', viewerHtml);

        document.addEventListener('click', function(e) {
            const dropdown = document.getElementById('igModelDropdown');
            const input = document.getElementById('igModelName');
            if (dropdown && dropdown.classList.contains('show')) {
                if (!dropdown.contains(e.target) && e.target !== input) {
                    dropdown.classList.remove('show');
                }
            }

            if (e.target && e.target.tagName === 'IMG') {
                if (e.target.closest('.message-content') || e.target.closest('.moments-image') || e.target.closest('.post-content-area')) {
                    const src = e.target.getAttribute('src');
                    if (src && !src.includes('data:image/svg+xml')) {
                        e.preventDefault();
                        e.stopPropagation(); 

                        const viewer = document.getElementById('igImageViewer');
                        const viewerImg = document.getElementById('igImageViewerImg');
                        const saveBtn = document.getElementById('igSaveImageBtn');
                        
                        viewerImg.src = src;
                        viewer.style.display = 'flex';
                        
                        saveBtn.onclick = async () => {
                            const originalText = saveBtn.textContent;
                            saveBtn.style.transform = 'scale(0.92)';
                            setTimeout(()=> saveBtn.style.transform = 'scale(1)', 100);

                            try {
                                saveBtn.textContent = '下载中...';
                                if (src.startsWith('data:')) {
                                    const a = document.createElement('a');
                                    a.href = src;
                                    a.download = `JRSY_Image_${Date.now()}.png`;
                                    a.click();
                                } else {
                                    const res = await fetch(src);
                                    const blob = await res.blob();
                                    const blobUrl = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = blobUrl;
                                    a.download = `JRSY_Image_${Date.now()}.png`;
                                    a.click();
                                    URL.revokeObjectURL(blobUrl);
                                }
                                saveBtn.textContent = '保存成功';
                            } catch(err) {
                                window.open(src, '_blank');
                                saveBtn.textContent = '已新窗口打开';
                            }
                            setTimeout(() => {
                                saveBtn.textContent = originalText;
                            }, 2000);
                        };
                    }
                }
            }
        }, true);
    }

    ImageGenPlugin = {
        init: async function() {
            injectPluginUI();
            await this.loadData();
        },

        loadData: async function() {
            try {
                const stored = localStorage.getItem('jrsy_image_gen_settings');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    Object.assign(igSettings, parsed);
                } else {
                    const appSettings = await dbManager.get('appSettings', 'settings');
                    if (appSettings && appSettings.imageGenSettings) {
                        Object.assign(igSettings, appSettings.imageGenSettings);
                    }
                }
            } catch (e) { console.error("加载生图设置失败:", e); }
        },

        shouldGenerate: async function(friendId) {
            await this.loadData(); 
            if (!igSettings.enabled) return false;
            if (!igSettings.apiUrl || !igSettings.apiKey || !igSettings.modelName) return false;
            return igSettings.activeAiIds.includes(friendId);
        },

        openSettings: async function() {
            await this.init(); 
            document.getElementById('igGlobalToggle').checked = igSettings.enabled;
            document.getElementById('igApiUrl').value = igSettings.apiUrl || '';
            document.getElementById('igApiKey').value = igSettings.apiKey || '';
            document.getElementById('igModelName').value = igSettings.modelName || '';
            document.getElementById('igImageSize').value = igSettings.imageSize || '1024x1024';
            document.getElementById('igGlobalPrompt').value = igSettings.globalPrompt || '';
            document.getElementById('igRoleSelectRow').style.display = igSettings.enabled ? 'flex' : 'none';
            setActivePage('imageGenSettingsScreen');
        },

        closeSettings: function() { setActivePage('settingsApp'); },

        toggleGlobal: function() {
            const isEnabled = document.getElementById('igGlobalToggle').checked;
            document.getElementById('igRoleSelectRow').style.display = isEnabled ? 'flex' : 'none';
        },

        saveSettings: async function() {
            igSettings.enabled = document.getElementById('igGlobalToggle').checked;
            igSettings.apiUrl = document.getElementById('igApiUrl').value.trim();
            igSettings.apiKey = document.getElementById('igApiKey').value.trim();
            igSettings.modelName = document.getElementById('igModelName').value.trim();
            igSettings.imageSize = document.getElementById('igImageSize').value;
            igSettings.globalPrompt = document.getElementById('igGlobalPrompt').value.trim();

            if (igSettings.enabled && (!igSettings.apiUrl || !igSettings.apiKey || !igSettings.modelName)) {
                return showAlert("开启生图功能需填满 API地址、密钥 和 模型名称！");
            }

            localStorage.setItem('jrsy_image_gen_settings', JSON.stringify(igSettings));
            showToast("生图配置已保存！");
            this.closeSettings();
        },

        openRoleModal: function() {
            const container = document.getElementById('igRoleList');
            container.innerHTML = '';
            const aiFriends = friends.filter(f => !f.isGroup);
            if (aiFriends.length === 0) {
                container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">暂无AI好友</div>';
            } else {
                aiFriends.forEach(friend => {
                    const isChecked = igSettings.activeAiIds.includes(friend.id);
                    const item = document.createElement('div');
                    item.className = 'multi-select-item';
                    item.innerHTML = `
                        <input type="checkbox" id="ig-role-${friend.id}" value="${friend.id}" ${isChecked ? 'checked' : ''}>
                        <label for="ig-role-${friend.id}">${friend.remark || friend.name}</label>
                    `;
                    container.appendChild(item);
                });
            }
            document.getElementById('imageGenRoleModal').classList.add('show');
        },

        closeRoleModal: function() { document.getElementById('imageGenRoleModal').classList.remove('show'); },
        confirmRoles: function() {
            igSettings.activeAiIds = [];
            document.querySelectorAll('#igRoleList input:checked').forEach(cb => { igSettings.activeAiIds.push(cb.value); });
            this.closeRoleModal();
            showToast(`已选择 ${igSettings.activeAiIds.length} 个生效角色`);
            localStorage.setItem('jrsy_image_gen_settings', JSON.stringify(igSettings));
        },

        toggleDropdown: function() { document.getElementById('igModelDropdown').classList.toggle('show'); },
        selectModel: function(name) {
            document.getElementById('igModelName').value = name;
            document.getElementById('igModelDropdown').classList.remove('show');
        },

        fetchModels: async function() {
            const url = document.getElementById('igApiUrl').value.trim();
            const key = document.getElementById('igApiKey').value.trim();
            if (!url || !key) return showAlert('请先填写API地址和密钥');

            showToast("正在拉取模型...");
            try {
                const baseUrl = url.endsWith('/v1') ? url : (url.endsWith('/') ? url + 'v1' : url + '/v1');
                const response = await fetch(`${baseUrl}/models`, { headers: { 'Authorization': `Bearer ${key}` } });
                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                const data = await response.json();
                
                const dropdown = document.getElementById('igModelDropdown');
                dropdown.innerHTML = '';
                (data.data || []).forEach(model => {
                    const option = document.createElement('div');
                    option.className = 'model-option';
                    option.textContent = model.id;
                    option.onclick = () => this.selectModel(model.id);
                    dropdown.appendChild(option);
                });
                dropdown.classList.add('show');
                showToast(`成功获取 ${data.data.length} 个模型`);
            } catch (e) { showAlert(`拉取失败: ${e.message}`); }
        },

        openFaceLockModal: function() {
            if (!currentChatFriendId) return showAlert("请先进入具体的聊天窗口后再设置锁脸");
            const friend = friends.find(f => f.id === currentChatFriendId);
            if (!friend) return;

            const lockData = friend.faceLockSettings || {};
            document.getElementById('faceLockPromptInput').value = lockData.prompt || '';
            
            const uploadBox = document.getElementById('faceLockImageUpload');
            const previewText = document.getElementById('faceLockImagePreview');
            tempFaceLockImage = lockData.image || '';

            if (tempFaceLockImage) {
                uploadBox.style.backgroundImage = `url(${tempFaceLockImage})`;
                previewText.textContent = '';
            } else {
                uploadBox.style.backgroundImage = '';
                previewText.textContent = '+';
            }

            document.getElementById('faceLockSettingsModal').classList.add('show');
        },

        closeFaceLockModal: function() {
            document.getElementById('faceLockSettingsModal').classList.remove('show');
            tempFaceLockImage = '';
        },

        handleFaceLockImageUpload: async function(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                showToast("正在处理参考图...");
                // 深度优化：将垫图进一步压缩至 512，能极大提升垫图接口和上传的速度！
                const compressedImage = await compressImage(file, { quality: 0.6, maxWidth: 512 });
                tempFaceLockImage = compressedImage;
                
                const uploadBox = document.getElementById('faceLockImageUpload');
                const previewText = document.getElementById('faceLockImagePreview');
                uploadBox.style.backgroundImage = `url(${compressedImage})`;
                previewText.textContent = '';
            } catch (error) {
                console.error("垫图压缩失败:", error);
                showAlert("图片处理失败，请重试。");
            }
            event.target.value = ''; 
        },

        saveFaceLockSettings: async function() {
            const friend = friends.find(f => f.id === currentChatFriendId);
            if (!friend) return;

            const promptText = document.getElementById('faceLockPromptInput').value.trim();

            friend.faceLockSettings = {
                prompt: promptText,
                image: tempFaceLockImage
            };

            await saveData();
            showToast("专属长相特征与参考图已保存！");
            this.closeFaceLockModal();
        },

        clearFaceLockSettings: async function() {
            const friend = friends.find(f => f.id === currentChatFriendId);
            if (!friend) return;

            friend.faceLockSettings = null;
            await saveData();
            
            document.getElementById('faceLockPromptInput').value = '';
            document.getElementById('faceLockImageUpload').style.backgroundImage = '';
            document.getElementById('faceLockImagePreview').textContent = '+';
            tempFaceLockImage = '';
            
            showToast("已清除该角色的锁脸数据");
        },

        generateImage: async function(actionDescription, friendId) {
            if (!igSettings.apiUrl || !igSettings.apiKey) throw new Error("API未配置");

            const friend = friends.find(f => f.id === friendId);
            if (!friend) throw new Error("找不到该发图角色");

            if (!friend.imageGenSeed) {
                friend.imageGenSeed = Math.floor(Math.random() * 9000000000) + 1000000000; 
                await saveData(); 
            }
            const seed = friend.imageGenSeed;

            const faceLockData = friend.faceLockSettings || {};
            const faceLockPrompt = faceLockData.prompt ? `Character appearance: ${faceLockData.prompt}. ` : (friend.role ? `Character appearance: ${friend.role.substring(0, 200)}. ` : "");
            const referenceImageBase64 = faceLockData.image || null;

            let faceLockEnhancePrompt = "";
            if (referenceImageBase64) {
                faceLockEnhancePrompt = "(EXTREMELY IMPORTANT: The character's face MUST be exactly 100% identical to the provided reference image, highly consistent facial features, same person)";
            }

            const finalPrompt = `
                ${igSettings.globalPrompt ? igSettings.globalPrompt + ', ' : ''}
                ${faceLockPrompt}
                ${faceLockEnhancePrompt}
                Current scene and action: ${actionDescription}. 
                --seed ${seed}
            `.trim().replace(/\n/g, ' ');

            console.log(`[生图插件] 正在为 ${friend.name} 请求图片 (比例: ${igSettings.imageSize || '1024x1024'}):`, finalPrompt);

            let endpoint = igSettings.apiUrl.endsWith('/') ? igSettings.apiUrl.slice(0, -1) : igSettings.apiUrl;
            if (!endpoint.endsWith('/images/generations') && !endpoint.endsWith('/v1/images/generations')) {
                 endpoint = endpoint.endsWith('/v1') ? `${endpoint}/images/generations` : `${endpoint}/v1/images/generations`;
            }

            let payload = {
                model: igSettings.modelName,
                prompt: finalPrompt,
                n: 1,
                size: igSettings.imageSize || "1024x1024",
                seed: seed 
            };

            if (referenceImageBase64) {
                payload.image = referenceImageBase64;
                console.log(`[生图插件] 已附加锁脸参考垫图发起请求...`);
            }

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${igSettings.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`请求失败 (${response.status}): ${errText}`);
                }

                const data = await response.json();
                
                // 【【【 智能多格式解析补丁：彻底解决找不到图片URL问题 】】】
                console.log("[生图插件] API原始返回数据:", data);
                
                let imageUrl = null;

                // 1. 标准 OpenAI 格式 - URL
                if (data.data && data.data.length > 0 && data.data[0].url) {
                    imageUrl = data.data[0].url;
                } 
                // 2. 标准 OpenAI 格式 - Base64 (b64_json)
                else if (data.data && data.data.length > 0 && data.data[0].b64_json) {
                    // 如果模型直接返回 base64 源码，我们补全前缀把它变成合法图片链接
                    imageUrl = "data:image/png;base64," + data.data[0].b64_json;
                } 
                // 3. 部分 MJ/SD 第三方中转格式 (直接在根目录或叫 image_url)
                else if (data.url || data.image_url) {
                    imageUrl = data.url || data.image_url;
                } 
                // 4. 其他直接返回数组的奇怪情况
                else if (Array.isArray(data) && data.length > 0 && data[0].url) {
                    imageUrl = data[0].url;
                }

                // 最终判定是否拿到图片
                if (imageUrl) {
                    console.log(`[生图插件] ${friend.name} 生图成功!`);
                    return imageUrl;
                } else {
                    // 如果以上所有格式都没命中，就在报错里把 API 真正返回的乱码打出来，方便排错
                    throw new Error(`格式不支持或API欠费。原始返回截取: ${JSON.stringify(data).substring(0, 150)}...`);
                }

            } catch (error) {
                console.error("[生图插件] 接口请求异常:", error);
                throw error;
            }
        }
    };

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (!document.getElementById('imageGenSettingsScreen')) {
                injectPluginUI();
            }
        }, 500);
    });
    window.ImageGenPlugin = ImageGenPlugin;

})();