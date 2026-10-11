/**
 * @name GameTranslator
 * @author Do_Nothing150
 * @description Discord 游戏聊天翻译 — 多引擎、MC术语、口语优化（优化版）
 * @version 1.4.1
 * @source https://github.com/local/discord-translator
 */
module.exports = class GameTranslator {
    getName() { return 'GameTranslator'; }
    getDescription() { return 'Discord 游戏聊天翻译'; }
    getVersion() { return '1.4.1'; }
    getAuthor() { return 'Do_Nothing150'; }

    // ============================================================
    // 常量
    // ============================================================
    static MSG_SELECTORS = [
        'div[id^="message-content-"]', '[id^="message-content-"]',
        '[class*="messageContent_"]', '[class*="messageContent"]',
    ];
    static MSG_JOINED = GameTranslator.MSG_SELECTORS.join(',');
    static INPUT_SELECTOR = 'div[role="textbox"][data-slate-editor="true"], div[contenteditable="true"][role="textbox"]';
    static SCROLLER_SELECTORS = ['ol[class*="scrollerInner"]', '[class*="scrollerInner"]', '[role="log"]'];
    static CHINESE_RE = /[\u4e00-\u9fff]/g;
    static CACHE_TTL = 10 * 60 * 1000;
    static LANG_NAMES = {
        zh: '简体中文', en: '英语', ja: '日语', ko: '韩语',
        fr: '法语', de: '德语', es: '西班牙语', ru: '俄语',
    };
    static SEND_LANGS = [
        ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'],
        ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'], ['zh', '中文'],
    ];
    // 翻译引擎输入的最大字符数，超出直接截断，避免超长消息撑爆 token 或触发引擎上限
    static MAX_MSG_LEN = 400;

    // ============================================================
    // 生命周期
    // ============================================================
    start() {
        this.injected = true;
        // 对从存储加载的配置做类型校验，防止脏数据破坏运行
        const load = (k, d) => {
            try { const v = BdApi.Data.load('GameTranslator', k); return v === undefined || v === null ? d : v; } catch { return d; }
        };
        this.CONFIG = {
            recvLang: 'zh',
            sendLang: load('sendLang', 'en'),
            autoTranslate: load('autoTranslate', true) !== false,
            glossaryOn: load('glossaryOn', true) !== false,
            engine: ['bilibili', 'pollinations'].includes(load('engine', 'bilibili')) ? load('engine', 'bilibili') : 'bilibili',
            maxConcurrent: 2,
            cacheLimit: 800,
            minLength: 2,
            queueLimit: 30,
            batchWindow: 200,
            maxPending: 200,
            requestTimeout: 25000,
            debug: false,
        };
        this.cache = new Map();
        this.pending = new Set();
        this.done = new Set();
        this.queue = [];
        this.active = 0;
        this.stats = { success: 0, fail: 0, skipped: 0 };
        this.currentScroller = null;
        this.batchQueue = new Set();
        this.batchTimer = null;
        this._statsTimer = null;            // stats 防抖计时器
        this._dragHandlers = null;          // 拖拽事件监听器引用，用于 stop 时清理
        this.glossary = this.compileGlossary();
        this.setupObserver();
        this.startTimers();
        this.injectStyle();
        // 用 requestIdleCallback（无则回退 setTimeout），不阻塞首帧
        const idle = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : (cb) => setTimeout(cb, 0);
        idle(() => this.createPanel(), { timeout: 2000 });
        console.log('[GameTranslator] 已加载 v1.4.1 by Do_Nothing150');
    }
    stop() {
        this.injected = false;
        this.observer?.disconnect();
        clearInterval(this.scanInterval);
        clearInterval(this.cleanInterval);
        clearTimeout(this.batchTimer);
        if (this._statsTimer) { clearTimeout(this._statsTimer); this._statsTimer = null; }
        // 清理拖拽监听器（修复：之前只存不删，反复启停会累积监听）
        if (this._dragHandlers) {
            document.removeEventListener('mousemove', this._dragHandlers[0]);
            document.removeEventListener('mouseup', this._dragHandlers[1]);
            this._dragHandlers = null;
        }
        document.getElementById('gt-panel')?.remove();
        document.getElementById('gt-style')?.remove();
        document.querySelectorAll('.gt-translation').forEach(n => n.remove());
        console.log('[GameTranslator] 已停止');
    }

    // ============================================================
    // 术语表编译
    // ============================================================
    compileGlossary() {
        const RAW = `Minecraft|我的世界
MC|我的世界
Java Edition|Java版
Bedrock Edition|基岩版
Realms|领域服
Mojang|Mojang
Microsoft|微软
Minecraft Dungeons|我的世界：地下城
Minecraft Legends|我的世界：传奇
Launcher|启动器
MultiMC|MultiMC
Prism Launcher|Prism Launcher
CurseForge Launcher|CurseForge Launcher
ATLauncher|ATLauncher
HMCL|HMCL
PCL2|PCL2
BakaXL|BakaXL
Modrinth App|Modrinth App
Youtube|YouTube
moved videos|搬运的视频
reupload|搬运
reposted|转载
streamer|主播
stream|直播
brb|很快回来
idk|我不知道
nvm|算了
np|没问题
ty|谢谢
thx|谢谢
sry|抱歉
gn|晚安
gm|早上好
gl|祝好运
omw|在路上
tbh|说实话
ngl|不骗你
gg|打得好
wp|玩得漂亮
ez|轻松
noob|菜鸟
pro|高手
afk|挂机
g2g|得走了
ff|投降
op|超强
nerf|削弱
buff|增强
lag|延迟
scuffed|糟糕的
busted|太强了
meta|主流打法
toxic|毒性
tilt|心态崩了
smurf|炸鱼
tryhard|较真
clutch|关键发挥
chill|放松
salty|气急败坏
no cap|没骗你
sus|可疑的
based|有道理的
smh|摇头
vibe|氛围
dmg|伤害
DPS|每秒伤害
hp|生命值
MP|魔法值
XP|经验
hearts|心
stacks|组
armor|护甲
double chest|大箱子
Overworld|主世界
Nether|下界
End|末地
Biome|生物群系
Chunk|区块
Deep Dark|深暗之域
Crimson Forest|绯红森林
Warped Forest|诡异森林
Mushroom Fields|蘑菇岛
Mineshaft|废弃矿井
Woodland Mansion|林地府邸
Jungle Pyramid|丛林神庙
Desert Temple|沙漠神殿
Ocean Monument|海底神殿
Stronghold|要塞
Ancient City|远古城市
Bastion Remnant|堡垒遗迹
Village|村庄
Nether Fortress|下界要塞
Creeper|苦力怕
Enderman|末影人
Zombie|僵尸
Skeleton|骷髅
Wither Skeleton|凋灵骷髅
Ender Dragon|末影龙
Wither|凋灵
Warden|监守者
Piglin|猪灵
Hoglin|疣猪兽
Strider|炽足兽
Blaze|烈焰人
Ghast|恶魂
Witch|女巫
Villager|村民
Iron Golem|铁傀儡
Snow Golem|雪傀儡
Phantom|幻翼
Shulker|潜影贝
Pillager|掠夺者
Vindicator|卫道士
Evoker|唤魔者
Ravager|劫掠兽
Axolotl|美西螈
Allay|悦灵
Bedrock|基岩
Obsidian|黑曜石
Redstone|红石
Redstone Repeater|红石中继器
Redstone Comparator|红石比较器
Piston|活塞
Sticky Piston|黏性活塞
Dispenser|发射器
Hopper|漏斗
Crafting Table|工作台
Blast Furnace|高炉
Furnace|熔炉
Anvil|铁砧
Enchanting Table|附魔台
Beacon|信标
Ender Chest|末影箱
Shulker Box|潜影盒
Diamond|钻石
Emerald|绿宝石
Netherite|下界合金
Elytra|鞘翅
Trident|三叉戟
Totem of Undying|不死图腾
Ender Pearl|末影珍珠
Silk Touch|精准采集
Fortune|时运
Efficiency|效率
Unbreaking|耐久
Mending|经验修补
Sharpness|锋利
Smite|亡灵杀手
Looting|抢夺
Fire Aspect|火焰附加
Knockback|击退
Infinity|无限
Protection|保护
Feather Falling|摔落保护
Thorns|荆棘
Modpack|整合包
Mods|模组
Mod|模组
Plugin|插件
Shaders|光影
Optifine|高清修复
Fabric|Fabric
Forge|Forge
Vanilla|原版
Server|服务器
Client|客户端
Skin|皮肤
Cape|披风
Ban|封禁
Kick|踢出
Whitelist|白名单
CurseForge|CurseForge
Modrinth|Modrinth
MCMOD|MC百科
Minecraft Wiki|Minecraft Wiki
Chunkbase|Chunkbase
WorldEdit|WorldEdit
JEI|JEI
REI|REI
Create|机械动力
Botania|植物魔法
Twilight Forest|暮色森林
Aether|天境
Tinkers Construct|匠魂
Farmer's Delight|农夫乐事`;
        const map = new Map();
        for (const line of RAW.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            const i = t.indexOf('|');
            if (i <= 0) continue;
            const en = t.slice(0, i).trim(), cn = t.slice(i + 1).trim();
            if (!en || !cn) continue;
            // 过滤"英文==中文"的无效占位（如 MC|MC、Mojang|Mojang），避免白白消耗占位符
            if (en.toLowerCase() === cn.toLowerCase()) continue;
            map.set(en, cn);
        }
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const keys = [...map.keys()].sort((a, b) => b.length - a.length);
        const lower = new Map([...map.keys()].map(k => [k.toLowerCase(), k]));
        const reverse = new Map();
        for (const [en, cn] of map) if (!reverse.has(cn)) reverse.set(cn, en);
        const rkeys = [...reverse.keys()].sort((a, b) => b.length - a.length);
        return {
            map, lower, reverse,
            // 用非捕获分组 (?:...)，减少回溯开销
            pattern: new RegExp('\\b(?:' + keys.map(esc).join('|') + ')\\b', 'gi'),
            rpattern: new RegExp('(?:' + rkeys.map(esc).join('|') + ')', 'g'),
            restoreCache: new Map(),
            restoreCacheMax: 512,
        };
    }
    // 占位符标记：使用不易与正常文本冲突的标记
    static PH = (i) => `[MC${i}]`;
    static PH_RE = /\[MC\d+\]/gi;

    applyGlossary(text, targetLang) {
        if (!this.CONFIG.glossaryOn) return { text, placeholders: [] };
        const g = this.glossary;
        const placeholders = [];
        const toChinese = !targetLang || targetLang.startsWith('zh');
        const result = toChinese
            ? text.replace(g.pattern, m => {
                const key = g.lower.get(m.toLowerCase());
                if (!key) return m;
                const ph = GameTranslator.PH(placeholders.length);
                placeholders.push({ ph, val: g.map.get(key) });
                return ph;
            })
            : text.replace(g.rpattern, m => {
                const en = g.reverse.get(m);
                if (!en) return m;
                const ph = GameTranslator.PH(placeholders.length);
                placeholders.push({ ph, val: en });
                return ph;
            });
        return { text: result, placeholders };
    }
    restoreGlossary(text, placeholders) {
        if (!placeholders.length) return text;
        const g = this.glossary;
        let r = text;
        for (const { ph, val } of placeholders) {
            let re = g.restoreCache.get(ph);
            if (!re) {
                re = new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                // 限制缓存大小，防止长时间运行后内存膨胀
                if (g.restoreCache.size >= g.restoreCacheMax) {
                    const firstKey = g.restoreCache.keys().next().value;
                    g.restoreCache.delete(firstKey);
                }
                g.restoreCache.set(ph, re);
            }
            r = r.replace(re, val);
        }
        // 清理翻译引擎没有保留/丢弃的残留占位符
        return r.replace(GameTranslator.PH_RE, '');
    }

    // ============================================================
    // 口语预处理
    // ============================================================
    static PREPROCESS_RULES = [
        [/\b[uU]\b/g, 'you'],
        [/\bur\b/gi, 'your'], [/\b[rR]\b/g, 'are'],
        [/\bpls\b/gi, 'please'], [/\bthx\b/gi, 'thanks'],
        [/\bwanna\b/gi, 'want to'], [/\bgonna\b/gi, 'going to'],
        [/\bgotta\b/gi, 'got to'], [/\bcya\b/gi, 'see you'],
        [/\btho\b/gi, 'though'], [/\bcuz\b/gi, 'because'],
    ];
    preprocess(text) {
        let t = text;
        for (const [re, rep] of GameTranslator.PREPROCESS_RULES) t = t.replace(re, rep);
        // "you form" 这类把 from 误拼成 form 的情况（仅当它前面是 you/ur 等时修正，避免误伤合法 "form"）
        t = t.replace(/\b(you|u|ur)\s+(are|r)\s+form\b/gi, '$1 $2 from');
        t = t.replace(/\bform\b/gi, (m, off, str) => {
            const before = str.slice(0, off).toLowerCase();
            return /\b(you|u|ur)\s+(are|r)\s*$/.test(before) ? 'from' : m;
        });
        return t;
    }

    // ============================================================
    // 翻译引擎
    // ============================================================
    buildPrompt(lang) {
        const name = GameTranslator.LANG_NAMES[lang] || lang;
        return `你是 Discord 游戏聊天翻译助手。将用户发给你的消息翻译成${name}。
严格规则：
1. 只输出译文本身，不要任何解释、引号、前缀
2. 保留 @提及、#频道、链接、数字
3. 口语化、自然、符合游戏聊天习惯
4. 遇到 [MC0]、[MC1] 等方括号占位符，视为专有名词原样保留、不得翻译或删除
5. 如果原文已经是${name}，原样返回`;
    }
    async translateLLM(text, lang, endpoint) {
        const isBili = endpoint === 'bilibili';
        const url = isBili
            ? 'https://index-translate.bilibili.com/v1/chat/completions'
            : 'https://text.pollinations.ai/openai';
        const body = {
            model: isBili ? 'Index-Translate-35B-A3B' : 'openai',
            messages: [
                { role: 'system', content: this.buildPrompt(lang) },
                { role: 'user', content: text },
            ],
            temperature: 0.3,
        };
        if (isBili) body.max_tokens = 1000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.CONFIG.requestTimeout);
        try {
            const res = await BdApi.Net.fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res || !res.ok) {
                throw new Error((isBili ? 'B站' : 'Polli') + ' HTTP ' + (res ? res.status : '无响应'));
            }
            const data = await res.json();
            if (data.error) throw new Error((isBili ? 'B站: ' : 'Polli: ') + (data.error.message || '错误'));
            const c = data.choices?.[0]?.message?.content;
            if (!c) throw new Error('返回为空');
            return c.trim().replace(/^["'""']|["'""']$/g, '');
        } catch (e) {
            if (e.name === 'AbortError') throw new Error('请求超时');
            throw e;
        } finally {
            clearTimeout(timeoutId);
        }
    }
    async translateText(text, lang) {
        const engine = this.CONFIG.engine;
        try {
            return await this.translateLLM(text, lang, engine);
        } catch (e) {
            console.warn('[GameTranslator] ' + engine + ' 失败:', e.message);
            const other = engine === 'bilibili' ? 'pollinations' : 'bilibili';
            return await this.translateLLM(text, lang, other);
        }
    }

    // ============================================================
    // 并发队列
    // ============================================================
    enqueue(fn) {
        if (this.queue.length >= this.CONFIG.queueLimit) {
            this.stats.skipped++;
            this.updateStatsDebounced();
            return Promise.reject(new Error('队列已满，跳过'));
        }
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.pump();
        });
    }
    pump() {
        while (this.active < this.CONFIG.maxConcurrent && this.queue.length) {
            const { fn, resolve, reject } = this.queue.shift();
            this.active++;
            fn().then(resolve, reject).finally(() => {
                this.active--;
                this.pump();
            });
        }
    }

    // ============================================================
    // LRU 缓存
    // ============================================================
    cacheGet(k) {
        const v = this.cache.get(k);
        if (!v) return null;
        if (Date.now() - v.ts > GameTranslator.CACHE_TTL) {
            this.cache.delete(k);
            return null;
        }
        this.cache.delete(k);
        v.ts = Date.now();
        this.cache.set(k, v);
        return v;
    }
    cacheSet(k, v) {
        if (this.cache.has(k)) this.cache.delete(k);
        else if (this.cache.size >= this.CONFIG.cacheLimit) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(k, { ...v, ts: Date.now() });
    }
    clearCache() {
        this.cache.clear();
        this.done.clear();
        this.stats.skipped = 0;
        this.updateStats();
    }

    // ============================================================
    // DOM 观察
    // ============================================================
    setupObserver() {
        this.observer = new MutationObserver(muts => {
            if (!this.CONFIG.autoTranslate) return;
            for (const m of muts) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (this.matchesMsg(node)) this.batchQueue.add(node);
                    if (node.querySelectorAll) {
                        for (const el of this.queryAll(node)) this.batchQueue.add(el);
                    }
                }
            }
            this.scheduleBatch();
        });
    }
    scheduleBatch() {
        if (this.batchTimer) return;
        this.batchTimer = setTimeout(() => {
            this.batchTimer = null;
            this.flushBatch();
        }, this.CONFIG.batchWindow);
    }
    flushBatch() {
        if (!this.CONFIG.autoTranslate) { this.batchQueue.clear(); return; }
        if (this.queue.length >= this.CONFIG.queueLimit) { this.batchQueue.clear(); return; }
        const items = [...this.batchQueue];
        this.batchQueue.clear();
        for (const el of items) this.processMessage(el);
    }
    queryAll(root) {
        if (!root?.querySelectorAll) return [];
        const set = new Set();
        for (const sel of GameTranslator.MSG_SELECTORS) {
            try { root.querySelectorAll(sel).forEach(el => set.add(el)); } catch {}
        }
        return [...set];
    }
    matchesMsg(el) {
        if (!el?.matches) return false;
        return GameTranslator.MSG_SELECTORS.some(sel => {
            try { return el.matches(sel); } catch { return false; }
        });
    }
    isRealMessage(el) {
        if (!el || el.closest('button')) return false;
        if (el.closest('[class*="toolbar"]')) return false;
        return (el.textContent || '').trim().length >= this.CONFIG.minLength;
    }
    // 取稳定、尽量唯一的消息 ID，避免文本截断导致的 id 碰撞
    getMsgId(el) {
        if (el.id) return el.id;
        const li = el.closest('li[id^="chat-messages-"]');
        if (li) {
            const sibs = [...li.querySelectorAll(GameTranslator.MSG_JOINED)];
            const idx = sibs.indexOf(el);
            return idx >= 0 ? li.id + '-' + idx : li.id + '-0';
        }
        return 'text:' + (el.textContent || '').slice(0, 60);
    }
    isChinese(text) {
        if (!text) return false;
        const cn = (text.match(GameTranslator.CHINESE_RE) || []).length;
        return cn / text.length > 0.3;
    }
    extractText(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.gt-translation').forEach(n => n.remove());
        return (clone.textContent || '').trim();
    }
    injectTranslation(el, translated) {
        if (!el.isConnected || !translated) return;
        el.querySelectorAll('.gt-translation').forEach(n => n.remove());
        const div = document.createElement('div');
        div.className = 'gt-translation';
        div.textContent = translated;
        el.appendChild(div);
    }
    async processMessage(el) {
        if (!el?.isConnected || !this.isRealMessage(el)) return;
        const msgId = this.getMsgId(el);
        if (!msgId) return;

        // 已处理过：优先从缓存补渲染
        if (this.done.has(msgId)) {
            const cached = this.cacheGet(msgId);
            if (cached?.translated && !el.querySelector('.gt-translation')) {
                this.injectTranslation(el, cached.translated);
            }
            return;
        }
        if (this.pending.has(msgId)) return;

        const rawText = this.extractText(el);
        if (!rawText || rawText.length < this.CONFIG.minLength) { this.done.add(msgId); return; }
        if (this.isChinese(rawText)) { this.done.add(msgId); return; }

        const cached = this.cacheGet(msgId);
        if (cached && cached.original === rawText) {
            this.injectTranslation(el, cached.translated);
            this.done.add(msgId);
            return;
        }

        if (this.queue.length >= this.CONFIG.queueLimit) {
            // 队列满时标记跳过，避免每个批处理窗口反复重入、白白刷屏统计
            this.stats.skipped++;
            this.done.add(msgId);
            this.updateStatsDebounced();
            return;
        }
        if (this.done.size > 2000) this.done.clear();
        if (this.pending.size > this.CONFIG.maxPending) {
            const arr = [...this.pending];
            for (let i = 0; i < arr.length / 2; i++) this.pending.delete(arr[i]);
        }
        this.pending.add(msgId);
        try {
            const preprocessed = this.preprocess(rawText);
            const { text: processed, placeholders } = this.applyGlossary(preprocessed, this.CONFIG.recvLang);
            // 截断超长消息，保护 token / 引擎上限
            const capped = processed.length > GameTranslator.MAX_MSG_LEN ? processed.slice(0, GameTranslator.MAX_MSG_LEN) : processed;
            const raw = await this.enqueue(() => this.translateText(capped, this.CONFIG.recvLang));
            const translated = this.restoreGlossary(raw, placeholders);
            if (translated?.trim() && translated.trim() !== rawText.trim()) {
                this.cacheSet(msgId, { original: rawText, translated });
                if (el.isConnected) this.injectTranslation(el, translated);
                this.stats.success++;
            } else {
                this.cacheSet(msgId, { original: rawText, translated: '' });
            }
            this.done.add(msgId);
        } catch (e) {
            if (!e.message.includes('队列已满')) {
                this.stats.fail++;
                console.warn('[GameTranslator] 失败:', e.message);
                this.done.add(msgId); // 失败也标记 done，避免无限重试同一条消息
            }
        } finally {
            this.pending.delete(msgId);
            this.updateStatsDebounced();
        }
    }
    scan(root) {
        if (!this.CONFIG.autoTranslate || !root) return;
        for (const el of this.queryAll(root)) this.batchQueue.add(el);
        this.scheduleBatch();
    }

    // ============================================================
    // 定时器
    // ============================================================
    startTimers() {
        this.scanInterval = setInterval(() => {
            if (!this.injected) return;
            let s = null;
            for (const sel of GameTranslator.SCROLLER_SELECTORS) {
                s = document.querySelector(sel);
                if (s) break;
            }
            if (s && s !== this.currentScroller) {
                this.observer.disconnect();
                this.currentScroller = s;
                this.observer.observe(s, { childList: true, subtree: true });
                this.scan(s);
            }
            if (!document.getElementById('gt-panel')) this.createPanel();
        }, 1500);
        this.cleanInterval = setInterval(() => {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (now - v.ts > GameTranslator.CACHE_TTL) this.cache.delete(k);
            }
            if (this.done.size > 1000) {
                const keep = [...this.done].slice(-500);
                this.done.clear();
                keep.forEach(k => this.done.add(k));
            }
            this.updateStatsDebounced();
        }, 60000);
    }

    // ============================================================
    // 样式
    // ============================================================
    injectStyle() {
        if (document.getElementById('gt-style')) return;
        const style = document.createElement('style');
        style.id = 'gt-style';
        style.textContent = `
            .gt-translation {
                margin-top: 6px;
                padding: 4px 8px;
                border-left: 3px solid #5865f2;
                color: #b9bbbe;
                font-size: 13px;
                line-height: 1.4;
                white-space: pre-wrap;
                word-break: break-word;
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================================
    // 面板状态（防抖，避免高频刷新 DOM）
    // ============================================================
    updateStats() {
        // 立即刷新一次（用于 clearCache 等场景）
        if (this._statsTimer) { clearTimeout(this._statsTimer); this._statsTimer = null; }
        this._renderStats();
    }
    updateStatsDebounced() {
        // 简单节流：300ms 内只安排一次渲染
        if (this._statsTimer) return;
        this._statsTimer = setTimeout(() => {
            this._statsTimer = null;
            this._renderStats();
        }, 300);
    }
    _renderStats() {
        const s = document.getElementById('gt-stats');
        if (!s) return;
        s.textContent = `✓${this.stats.success} ✗${this.stats.fail} ⏭${this.stats.skipped} Q${this.queue.length}`;
    }
    flash(msg) {
        const s = document.getElementById('gt-status');
        if (!s) return;
        s.textContent = msg;
        clearTimeout(s._t);
        s._t = setTimeout(() => { s.textContent = ''; }, 3500);
    }

    // ============================================================
    // 面板 UI
    // ============================================================
    createPanel() {
        if (document.getElementById('gt-panel')) return;
        const self = this;
        const p = document.createElement('div');
        p.id = 'gt-panel';
        p.style.cssText = 'position:fixed;right:12px;bottom:60px;z-index:99999;background:rgba(30,31,34,0.95);border:1px solid #5865f2;border-radius:6px;padding:6px 8px;font-family:sans-serif;font-size:10px;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);width:160px;user-select:none;';
        const h = document.createElement('div');
        h.id = 'gt-header';
        h.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        h.innerHTML = '<span style="font-weight:600;color:#5865f2;font-size:10px;pointer-events:none;">Discord 翻译</span>'
            + '<span style="display:flex;gap:2px;">'
            + '<span id="gt-adv" title="高级设置" style="cursor:pointer;color:#b9bbbe;font-size:10px;padding:0 2px;">⚙</span>'
            + '<span id="gt-collapse" style="cursor:pointer;color:#b9bbbe;font-size:10px;padding:0 2px;">▾</span>'
            + '</span>';
        p.appendChild(h);
        const body = document.createElement('div');
        body.id = 'gt-body';
        const engRow = document.createElement('div');
        engRow.style.cssText = 'display:flex;gap:3px;margin-bottom:4px;';
        for (const [key, label] of [['bilibili', 'B站'], ['pollinations', 'Polli']]) {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.dataset.engine = key;
            btn.style.cssText = 'flex:1;padding:2px 0;font-size:9px;border-radius:2px;cursor:pointer;border:none;' +
                (this.CONFIG.engine === key ? 'background:#5865f2;color:#fff;font-weight:600;' : 'background:#3a3c42;color:#b9bbbe;');
            btn.onclick = () => {
                self.CONFIG.engine = key;
                BdApi.Data.save('GameTranslator', 'engine', key);
                engRow.querySelectorAll('button').forEach(b => {
                    const on = b.dataset.engine === key;
                    b.style.background = on ? '#5865f2' : '#3a3c42';
                    b.style.color = on ? '#fff' : '#b9bbbe';
                    b.style.fontWeight = on ? '600' : 'normal';
                });
                self.clearCache();
                if (self.currentScroller) self.scan(self.currentScroller);
                self.flash('已切到 ' + label);
            };
            engRow.appendChild(btn);
        }
        body.appendChild(engRow);
        body.appendChild(this.makeSwitch('接收', this.CONFIG.autoTranslate, v => {
            self.CONFIG.autoTranslate = v;
            BdApi.Data.save('GameTranslator', 'autoTranslate', v);
            if (v && self.currentScroller) self.scan(self.currentScroller);
        }));
        const sendRow = document.createElement('div');
        sendRow.style.cssText = 'display:flex;align-items:center;gap:3px;margin-top:4px;';
        const sel = document.createElement('select');
        sel.style.cssText = 'flex:1;min-width:0;background:#2b2d31;color:#fff;border:1px solid #444;border-radius:2px;padding:1px 3px;font-size:10px;outline:none;cursor:pointer;';
        for (const [code, label] of GameTranslator.SEND_LANGS) {
            const o = document.createElement('option');
            o.value = code; o.textContent = label;
            if (code === this.CONFIG.sendLang) o.selected = true;
            sel.appendChild(o);
        }
        sel.onchange = () => {
            self.CONFIG.sendLang = sel.value;
            BdApi.Data.save('GameTranslator', 'sendLang', sel.value);
        };
        sendRow.appendChild(sel);
        const btn = document.createElement('button');
        btn.id = 'gt-send-btn';
        btn.textContent = '译';
        btn.style.cssText = 'background:#5865f2;color:#fff;border:none;border-radius:2px;padding:2px 8px;font-size:10px;cursor:pointer;font-weight:600;flex-shrink:0;';
        btn.onclick = () => this.translateInput();
        sendRow.appendChild(btn);
        body.appendChild(sendRow);
        const status = document.createElement('div');
        status.id = 'gt-status';
        status.style.cssText = 'color:#faa61a;font-size:9px;height:11px;line-height:11px;text-align:center;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        body.appendChild(status);
        const adv = document.createElement('div');
        adv.id = 'gt-adv-area';
        adv.style.cssText = 'display:none;margin-top:4px;border-top:1px solid #3a3c42;padding-top:4px;';
        adv.appendChild(this.makeSwitch('MC术语表', this.CONFIG.glossaryOn, v => {
            self.CONFIG.glossaryOn = v;
            BdApi.Data.save('GameTranslator', 'glossaryOn', v);
            self.clearCache();
            if (self.currentScroller) self.scan(self.currentScroller);
        }));
        const actRow = document.createElement('div');
        actRow.style.cssText = 'display:flex;gap:3px;margin:4px 0;';
        const testBtn = this.makeButton('测试', async () => {
            testBtn.disabled = true; testBtn.textContent = '...';
            try {
                const r = await self.translateText('hello', 'zh');
                self.flash('✓ ' + (r || '').slice(0, 15));
            } catch (e) { self.flash('✗ ' + e.message.slice(0, 15)); }
            finally { testBtn.disabled = false; testBtn.textContent = '测试'; }
        });
        actRow.appendChild(testBtn);
        const retBtn = this.makeButton('重翻', () => {
            self.clearCache();
            document.querySelectorAll('.gt-translation').forEach(n => n.remove());
            if (self.currentScroller) self.scan(self.currentScroller);
            self.flash('重翻中');
        });
        actRow.appendChild(retBtn);
        adv.appendChild(actRow);
        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:4px;';
        const statsEl = document.createElement('div');
        statsEl.id = 'gt-stats';
        statsEl.style.cssText = 'color:#5865f2;font-size:9px;';
        statsEl.textContent = '✓0 ✗0 ⏭0 Q0';
        statsRow.appendChild(statsEl);
        const clearBtn = document.createElement('span');
        clearBtn.textContent = '🗑';
        clearBtn.title = '清空缓存';
        clearBtn.style.cssText = 'cursor:pointer;font-size:9px;color:#b9bbbe;padding:0 2px;';
        clearBtn.onclick = () => { self.clearCache(); self.flash('已清缓存'); };
        statsRow.appendChild(clearBtn);
        adv.appendChild(statsRow);
        body.appendChild(adv);
        p.appendChild(body);
        document.body.appendChild(p);
        this.setupDrag(p, h);
        document.getElementById('gt-collapse').onclick = (e) => {
            e.stopPropagation();
            const c = body.style.display === 'none';
            body.style.display = c ? 'block' : 'none';
            document.getElementById('gt-collapse').textContent = c ? '▾' : '▸';
        };
        document.getElementById('gt-adv').onclick = (e) => {
            e.stopPropagation();
            const show = adv.style.display === 'none';
            adv.style.display = show ? 'block' : 'none';
            document.getElementById('gt-adv').style.color = show ? '#5865f2' : '#b9bbbe';
        };
    }
    makeSwitch(text, initial, onChange) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:4px 0;';
        const l = document.createElement('span');
        l.textContent = text;
        l.style.cssText = 'color:#ddd;font-size:10px;';
        row.appendChild(l);
        let on = initial;
        const sw = document.createElement('div');
        sw.style.cssText = 'width:26px;height:14px;border-radius:7px;cursor:pointer;transition:background 0.2s;position:relative;flex-shrink:0;background:' + (on ? '#5865f2' : '#4e5058');
        const k = document.createElement('div');
        k.style.cssText = 'position:absolute;top:2px;left:' + (on ? '14px' : '2px') + ';width:10px;height:10px;border-radius:50%;background:#fff;transition:left 0.2s;';
        sw.appendChild(k);
        sw.onclick = () => {
            on = !on;
            sw.style.background = on ? '#5865f2' : '#4e5058';
            k.style.left = on ? '14px' : '2px';
            onChange(on);
        };
        row.appendChild(sw);
        return row;
    }
    makeButton(text, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = 'flex:1;background:#3a3c42;color:#ddd;border:none;border-radius:2px;padding:2px 0;font-size:9px;cursor:pointer;';
        btn.onclick = onClick;
        return btn;
    }
    setupDrag(panel, handle) {
        let drag = null;
        handle.style.cursor = 'move';
        handle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'gt-collapse' || e.target.id === 'gt-adv') return;
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            const rect = panel.getBoundingClientRect();
            drag = { x: e.clientX, y: e.clientY, L: rect.left, T: rect.top, moved: false };
            e.preventDefault();
        });
        const onMove = (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            drag.moved = true;
            let L = drag.L + dx, T = drag.T + dy;
            L = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, L));
            T = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, T));
            panel.style.left = L + 'px';
            panel.style.top = T + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        };
        const onUp = () => {
            if (!drag) return;
            if (drag.moved) {
                const rect = panel.getBoundingClientRect();
                BdApi.Data.save('GameTranslator', 'panelPos', { x: rect.left, y: rect.top });
            }
            drag = null;
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        // 保存引用，stop() 时清理
        this._dragHandlers = [onMove, onUp];
        const pos = BdApi.Data.load('GameTranslator', 'panelPos');
        if (pos && typeof pos.x === 'number') {
            panel.style.left = pos.x + 'px';
            panel.style.top = pos.y + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
    }

    // ============================================================
    // 发送翻译
    // ============================================================
    getInputBox() {
        return document.querySelector(GameTranslator.INPUT_SELECTOR);
    }
    async copyToClipboard(text) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch {}
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch { return false; }
    }
    // 尝试直接把译文写回 Discord 输入框（contenteditable），失败则回退到复制
    trySetInput(text) {
        const box = this.getInputBox();
        if (!box) return false;
        try {
            box.focus();
            // 选中现有内容
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(box);
            sel.removeAllRanges();
            sel.addRange(range);
            // 用 execCommand 替换
            const ok = document.execCommand('insertText', false, text);
            if (!ok) return false;
            // 只要写入后非空就视为成功，避免短译文误判
            return (box.textContent || '').trim().length > 0;
        } catch { return false; }
    }
    async translateInput() {
        const box = this.getInputBox();
        if (!box) return this.flash('找不到输入框');
        const text = (box.textContent || '').trim();
        if (!text) return this.flash('输入框为空');
        const btn = document.getElementById('gt-send-btn');
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const { text: processed, placeholders } = this.applyGlossary(text, this.CONFIG.sendLang);
            const capped = processed.length > GameTranslator.MAX_MSG_LEN ? processed.slice(0, GameTranslator.MAX_MSG_LEN) : processed;
            const raw = await this.translateText(capped, this.CONFIG.sendLang);
            const translated = this.restoreGlossary(raw, placeholders);
            if (!translated?.trim()) return this.flash('结果为空');

            // 优先直接写入输入框；不行再复制给用户手动粘贴
            if (this.trySetInput(translated)) {
                this.flash('译文已填入输入框');
            } else {
                const ok = await this.copyToClipboard(translated);
                if (ok) this.flash('译文已复制，Ctrl+V');
                else { this.flash('复制失败'); console.log('[GameTranslator] 译文：', translated); }
            }
        } catch (e) {
            console.warn('[GameTranslator] 发送失败:', e.message);
            this.flash(e.message.slice(0, 40));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '译'; }
        }
    }
};