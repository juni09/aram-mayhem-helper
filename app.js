(function () {
  const E = window.Engine;
  const AUGS = window.AUGMENTS || [];
  const CHAMPS = window.CHAMPIONS || [];
  const CH = {};
  CHAMPS.forEach(c => { CH[c.id] = c; });
  const $ = id => document.getElementById(id);
  const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
  const ITEMS = window.ITEMS || {};
  let pendingFresh = 0;      // 직접 입력: 방금 새로고침한 자리로 들어올 카드 수
  // 새로고침은 카드마다 1번씩. 새로고침으로 들어온 카드는 다시 돌릴 수 없다.
  const canReroll = id => !state.fresh.includes(id);
  const rerollsLeft = () => state.offered.filter(canReroll).length;
  const MAX_OFFER = 4;   // 선택지는 보통 3개, 패치 이후 4개가 나오는 경우도 있다
  // 강의에서 줄여 부르는 이름 → 게임 내 정식 이름
  const ITEM_ALIAS = { '무라마나': '마나무네', '군주의 피갑옷': '지배자의 피갑옷', '아이오니아 장화': '명석함의 아이오니아 장화', '마법공학 벨트': '마법공학 로켓 벨트', '대천사의 포옹': '대천사의 지팡이', '검은 불꽃 횃불': '어둠불꽃 횃불', '잃어버린 양피지': '사라진 양피지', '지배자의 피갑': '지배자의 피갑옷' };

  // ---------- 상태 ----------
  const state = { champ: null, variant: 0, owned: [], offered: [], target: 'offered', rarity: 'all', rankRarity: 'all', q: '', open: {}, opacity: 100, live: true, rerolls: 2, seen: [], share: false, autoScan: true, fresh: [], rounds: [] };
  try {
    const saved = JSON.parse(localStorage.getItem('augHelper') || '{}');
    ['champ', 'variant', 'owned', 'opacity', 'live', 'seen', 'share', 'autoScan', 'rounds', 'headliner', 'fresh'].forEach(k => { if (saved[k] != null) state[k] = saved[k]; });
    state.owned = state.owned.filter(id => E.AUG[id]);
    state.seen = (state.seen || []).filter(id => E.AUG[id]);
    if (!CH[state.champ]) state.champ = null;
  } catch (e) { /* 저장소를 못 쓰면 그냥 새로 시작 */ }
  // 점검용: 주소 뒤에 #state={...} 를 붙이면 그 상태로 연다.
  try {
    if (location.hash.startsWith('#state=')) Object.assign(state, JSON.parse(decodeURIComponent(location.hash.slice(7))));
  } catch (e) { /* 무시 */ }
  function save() {
    try {
      localStorage.setItem('augHelper', JSON.stringify({ champ: state.champ, variant: state.variant, owned: state.owned, opacity: state.opacity, live: state.live, seen: state.seen, share: state.share, autoScan: state.autoScan, rounds: state.rounds, headliner: state.headliner, fresh: state.fresh }));
    } catch (e) { /* 무시 */ }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  let HELPER = null;      // 자동 인식 도우미가 연결돼 있는가 (맥 창 안에서는 항상 true)
  const SPR = window.SPRITES || null;
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  function setIcon(i, src) {
    const m = SPR && SPR.map[src];
    if (m) {
      const sh = SPR.sheets[m[0]];
      i.src = BLANK;
      i.style.backgroundImage = `url(${sh.file})`;
      i.style.backgroundSize = `${sh.cols * 100}% ${sh.rows * 100}%`;
      i.style.backgroundPosition = `${sh.cols > 1 ? m[1] / (sh.cols - 1) * 100 : 0}% ${sh.rows > 1 ? m[2] / (sh.rows - 1) * 100 : 0}%`;
    } else {
      i.style.backgroundImage = '';
      i.src = src || BLANK;
    }
  }
  function img(src, cls) {
    const i = el('img', cls);
    if (!SPR) i.loading = 'lazy';
    i.alt = '';
    setIcon(i, src);
    return i;
  }
  function videoLink(v) {
    if (!v) return null;
    const a = el('a', 'vid', '▶ 강의');
    a.href = 'https://www.youtube.com/watch?v=' + v;
    a.title = (E.K.videos || {})[v] || '강의 영상 열기';
    return a;
  }

  // ---------- 상단: 챔피언 ----------
  function renderTop() {
    const c = CH[state.champ];
    $('champName').textContent = c ? c.name : '챔피언 선택';
    setIcon($('champIcon'), c ? c.icon : '');
    $('champIcon').style.visibility = c ? 'visible' : 'hidden';
    const p = E.profile(state.champ, state.variant);
    $('champSub').textContent = c ? p.classes.map(x => E.CLASS_KO[x] || x).join('·') : '눌러서 고르기';
    const box = $('variants');
    box.innerHTML = '';
    const vs = c ? E.variantsOf(state.champ) : [];
    vs.forEach((label, i) => {
      const b = el('button', 'chip-btn' + (i === state.variant ? ' on' : ''), label);
      b.onclick = () => { state.variant = i; variantManual = true; save(); renderAll(); };
      box.appendChild(b);
    });
  }

  // ---------- 지금 상황: 조합을 읽고, 거기에 맞는 두리T 강의 노트를 고른다 ----------
  let scanStatus = '';
  let game = null;   // { level, time, allies:[id], enemies:[id] } — 게임에서 읽은 값
  const AUG_LEVELS = [1, 7, 11, 15];   // 실제 게임에서 확인: 첫 증강은 1레벨
  const FLAG_KO = {
    enemy_tanks: ['적 탱커 많음', '퍼센트 관통·체력 비례 피해의 가치가 높습니다.'],
    enemy_healers: ['적 회복 많음', '치유 감소를 누군가는 꼭 사야 합니다.'],
    enemy_shields: ['적 보호막 많음', '보호막을 깎는 수단을 챙기세요.'],
    enemy_ap: ['적 마법 피해 위주', '마법 저항력 효율이 좋습니다.'],
    enemy_ad: ['적 물리 피해 위주', '방어력 효율이 좋습니다.'],
    enemy_cc: ['적 군중 제어 많음', '강인함과 위치 선정이 중요합니다.'],
    enemy_poke: ['적 견제 조합', '체력 관리와 빠른 싸움 걸기가 중요합니다.'],
    enemy_dive: ['적 돌진·암살 많음', '생존 수단(존야, 방어 증강)을 먼저 생각하세요.'],
    enemy_squishy: ['적 물몸 위주', '폭딜·광역 피해가 잘 통합니다.'],
    enemy_armor: ['적이 방어력 템 올림', '방어구 관통이 필요합니다.'],
    enemy_mr: ['적이 마법 저항 템 올림', '마법 관통이 필요합니다.'],
    enemy_hp: ['적 체력 템 많음', '체력 비례 피해가 잘 통합니다.'],
    enemy_lifesteal: ['적 흡혈 템 있음', '치유 감소를 챙기세요.'],
    enemy_crit: ['적 치명타 빌드', '탱커라면 치명타 피해를 줄이는 템이 좋습니다.'],
    ally_no_tank: ['우리 팀 탱커 없음', '앞에 설 사람이 없습니다. 생존력을 챙기세요.'],
    ally_no_cc: ['우리 팀 CC 부족', '적 돌진을 막기 어렵습니다.'],
    ally_healers: ['우리 팀 회복 있음', '오래 싸우는 구도가 유리합니다.'],
  };
  // 적 한 명의 피해 유형: 산 아이템이 있으면 그걸로, 없으면 챔피언 기본 빌드로
  function foeDamage(f) {
    let ap = 0, ad = 0;
    f.items.forEach(i => {
      const t = (ITEM_DB[i] || {}).tags || [];
      if (t.includes('SpellDamage')) ap++;
      if (t.includes('Damage') || t.includes('CriticalStrike')) ad++;
    });
    if (ap !== ad) return ap > ad ? 'ap' : 'ad';
    const t = traitsOf(f.id);
    return t.has('ap') && !t.has('ad') ? 'ap' : t.has('ad') && !t.has('ap') ? 'ad' : 'mix';
  }
  function traitsOf(id) {
    const c = E.K.champs[id];
    return c ? new Set([...(c.traits || []), ...(c.class || [])]) : new Set();
  }
  function situation() {
    const flags = [];
    const p = E.profile(state.champ, state.variant);
    if (p.known) {
      ['marksman', 'mage', 'tank', 'bruiser', 'assassin', 'enchanter'].forEach(c => { if (p.classes[0] === c) flags.push('me_' + c); });
      ['ap', 'ad', 'crit', 'melee', 'ranged'].forEach(t => { if (p.traits.has(t)) flags.push('me_' + t); });
    }
    if (game) {
      const cnt = (ids, f) => ids.filter(id => f(traitsOf(id))).length;
      const en = game.enemies, al = game.allies;
      if (en.length >= 3) {
        const tanks = cnt(en, t => t.has('tank') || t.has('tankbuild'));
        let ap = cnt(en, t => t.has('ap') && !t.has('ad')), ad = cnt(en, t => t.has('ad') && !t.has('ap'));
        // 적이 실제로 산 아이템과 킬 수로 보정한다
        const foes = game.foes || [];
        const tagCount = tag => foes.reduce((n, f) => n + f.items.filter(i => ((ITEM_DB[i] || {}).tags || []).includes(tag) && (ITEM_DB[i].cost || 0) >= 1600).length, 0);
        const who = tag => foes.filter(f => f.items.some(i => ((ITEM_DB[i] || {}).tags || []).includes(tag) && (ITEM_DB[i].cost || 0) >= 1600)).length;
        if (tagCount('Armor') >= 3 || who('Armor') >= 3) flags.push('enemy_armor');
        if (tagCount('SpellBlock') >= 3 || who('SpellBlock') >= 3) flags.push('enemy_mr');
        if (tagCount('Health') >= 5) flags.push('enemy_hp');
        if (who('LifeSteal') + who('SpellVamp') >= 2) flags.push('enemy_lifesteal');
        if (who('CriticalStrike') >= 2) flags.push('enemy_crit');
        // 피해 유형: 킬을 많이 먹은 적일수록 무게를 더 준다
        let wAp = 0, wAd = 0;
        foes.forEach(f => {
          const dmg = foeDamage(f), w = 1 + f.k * 0.5;
          if (dmg === 'ap') wAp += w; else if (dmg === 'ad') wAd += w; else { wAp += w / 2; wAd += w / 2; }
        });
        if (wAp + wAd > 0) {
          if (wAp / (wAp + wAd) >= 0.65) { ap = 3; ad = 0; } else if (wAd / (wAp + wAd) >= 0.65) { ad = 3; ap = 0; } else { ap = ad = 2; }
        }
        if (tanks >= 2) flags.push('enemy_tanks');
        if (tanks === 0 && cnt(en, t => t.has('bruiser')) <= 1) flags.push('enemy_squishy');
        if (cnt(en, t => t.has('heal_self') || t.has('heal_ally')) >= 2) flags.push('enemy_healers');
        if (cnt(en, t => t.has('shield') || t.has('heal_ally')) >= 3) flags.push('enemy_shields');
        if (ap >= 3 && ad <= 1) flags.push('enemy_ap');
        if (ad >= 3 && ap <= 1) flags.push('enemy_ad');
        if (cnt(en, t => t.has('cc')) >= 3) flags.push('enemy_cc');
        if (cnt(en, t => t.has('poke')) >= 3) flags.push('enemy_poke');
        if (cnt(en, t => t.has('assassin') || (t.has('dash') && t.has('melee'))) >= 3) flags.push('enemy_dive');
      }
      if (al.length >= 3) {
        if (cnt(al, t => t.has('tank') || t.has('tankbuild')) === 0) flags.push('ally_no_tank');
        if (cnt(al, t => t.has('cc')) <= 1) flags.push('ally_no_cc');
        if (cnt(al, t => t.has('heal_ally')) >= 1) flags.push('ally_healers');
      }
      if (game.level && game.level < 7) flags.push('early');
      if (game.level && game.level >= 15) flags.push('late');
    }
    if (state.offered.length) flags.push('reroll');
    return flags;
  }
  // 상황에 맞는 노트: 내 챔피언 전용 > 조합 상황 > 내 부류
  function pickNotes(flags, limit) {
    const fs = new Set(flags);
    const scored = [];
    (E.K.general || []).forEach((n, i) => {
      let s = 0;
      // 특정 챔피언용 노트는 그 챔피언일 때만
      if ((n.champs || []).length && !n.champs.includes(state.champ)) return;
      if ((n.champs || []).includes(state.champ)) s += 10;
      (n.when || []).forEach(w => {
        if (!fs.has(w)) return;
        s += (w.startsWith('enemy_') || w.startsWith('ally_')) ? 5 : w === 'reroll' ? 4 : (w === 'early' || w === 'late') ? 2 : 1.5;
      });
      // 내 부류와 반대되는 노트는 뺀다 (원딜인데 탱커용 팁 등)
      const meTags = (n.when || []).filter(w => w.startsWith('me_'));
      if (meTags.length && !meTags.some(w => fs.has(w)) && !(n.champs || []).includes(state.champ)) s = 0;
      if (s > 0) scored.push({ n, s: s - i * 0.001 });
    });
    return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.n);
  }
  function renderSituation() {
    const box = $('sit');
    box.innerHTML = '';
    if (!state.champ) { $('sitBlock').hidden = true; $('planBlock').hidden = true; return; }
    $('sitBlock').hidden = false;
    const flags = situation();
    const head = [];
    if (game && game.level) {
      const lv = state.headliner === 'worlds' ? [...AUG_LEVELS, 21] : AUG_LEVELS;
      const next = lv.find(l => l > game.level);
      head.push(`${game.level}레벨`);
      head.push(next ? `다음 증강 ${next}레벨 (죽었을 때나 우물에서 고름)` : '증강 선택 끝');
    }
    if (scanStatus) head.push(scanStatus);
    $('sitHead').textContent = head.join(' · ');

    const ct = (E.K.champTiers || {})[state.champ];
    if (ct) {
      const d = el('div', 'sit-line tier-' + ct.tier);
      d.appendChild(el('b', null, `두리T ${E.CLASS_KO[ct.class] || ''} 챔피언 티어 ${ct.tier}`));
      if (ct.note) d.appendChild(el('span', null, ct.note));
      const v = videoLink(ct.video); if (v) d.appendChild(v);
      box.appendChild(d);
    }
    // 이번 판 방향: 팀에서의 내 역할 + 가장 위협적인 적 + 증강·템 방향을 한데 모은다
    const role = teamRole();
    const dir = el('div', 'plan');
    role.lines.slice(0, 2).forEach(t => dir.appendChild(el('div', 'plan-line', '👥 ' + t)));
    if (game && (game.foes || []).length) {
      const top = game.foes.slice().sort((a, b) => (b.k * 2 - b.d + b.level * 0.3) - (a.k * 2 - a.d + a.level * 0.3))[0];
      const dmg = foeDamage(top);
      if (top.k >= 2) dir.appendChild(el('div', 'plan-line', `⚠ 가장 위협적인 적: ${CH[top.id].name} (${top.k}/${top.d}/${top.a}, ${dmg === 'ap' ? '마법' : dmg === 'ad' ? '물리' : '혼합'} 피해)`));
    }
    const AUG_DIR = { enemy_dive: '생존·보호막·부활', enemy_poke: '회복·보호막·진입', enemy_tanks: '체력 비례·관통·지속 딜', enemy_squishy: '폭딜·광역', enemy_cc: '강인함·군중 제어 면역', ally_no_tank: '방어·생존', ally_healers: '체력·회복 증폭' };
    const want = flags.filter(f => AUG_DIR[f]).map(f => AUG_DIR[f]);
    if (want.length) dir.appendChild(el('div', 'plan-line', '🎯 이번 판에 값진 증강: ' + [...new Set(want)].slice(0, 3).join(' / ')));
    const sitItems = buildList().filter(x => x.tag === '상황' && !x.have).slice(0, 2);
    if (sitItems.length) dir.appendChild(el('div', 'plan-line', '🛒 적에 맞춘 템: ' + sitItems.map(x => `${x.name} (${x.why.split('→')[0].trim()})`).join(', ')));
    // 판단의 기준이 되므로 화면 맨 위에 둔다
    const pb = $('plan'); pb.innerHTML = '';
    $('planBlock').hidden = !dir.childNodes.length || !!selectData;
    if (dir.childNodes.length) { pb.appendChild(el('div', 'plan-head', '이번 판 방향')); pb.appendChild(dir); }
    const comp = flags.filter(f => FLAG_KO[f]);
    if (comp.length) {
      const chips = el('div', 'chips');
      comp.forEach(f => {
        const c = el('span', 'sit-chip ' + (f.startsWith('enemy') ? 'enemy' : 'ally'), FLAG_KO[f][0]);
        c.title = FLAG_KO[f][1];
        chips.appendChild(c);
      });
      box.appendChild(chips);
    }
    // 적 5명: 킬/데스, 피해 유형, 산 아이템
    const foes = game ? (game.foes || []) : [];
    if (foes.length) {
      const top = foes.slice().sort((a, b) => (b.k * 2 - b.d + b.level * 0.3) - (a.k * 2 - a.d + a.level * 0.3))[0];
      const tbl = el('div', 'foes');
      foes.forEach(f => {
        const c = CH[f.id];
        const row = el('div', 'foe' + (f === top && f.k >= 2 ? ' threat' : ''));
        row.appendChild(img(c.icon, 'foe-icon'));
        const dmg = foeDamage(f);
        const t = el('div', 'foe-text');
        t.appendChild(el('b', null, c.name + (f === top && f.k >= 2 ? ' ⚠' : '')));
        t.appendChild(el('span', 'sub', `${f.k}/${f.d}/${f.a} · ${dmg === 'ap' ? '마법' : dmg === 'ad' ? '물리' : '혼합'}`));
        row.appendChild(t);
        const its = el('div', 'foe-items');
        f.items.filter(i => ITEM_DB[i] && (ITEM_DB[i].cost || 0) >= 900).slice(0, 6).forEach(i => {
          const im = img(ITEM_DB[i].icon); im.title = ITEM_DB[i].name; its.appendChild(im);
        });
        row.appendChild(its);
        tbl.appendChild(row);
      });
      box.appendChild(tbl);
    }
    if (!ct && !comp.length && !foes.length && !role.lines.length) $('sitBlock').hidden = true;
  }
  // 강의 노트 탭 맨 위: 지금 상황에 맞는 노트
  function renderSitNotes() {
    const box = $('sitNotes');
    box.innerHTML = '';
    if (!state.champ) return;
    const notes = pickNotes(situation(), 6);
    if (!notes.length) return;
    box.appendChild(el('h2', null, '지금 상황에 맞는 노트'));
    notes.forEach(n => {
      const d = el('div', 'sit-note');
      d.appendChild(el('b', null, '💬 ' + n.topic));
      d.appendChild(el('span', null, n.text));
      const v = videoLink(n.video); if (v) d.appendChild(v);
      box.appendChild(d);
    });
    box.appendChild(el('h2', 'gap', '전체 노트'));
  }

  // ---------- 내 증강 ----------
  function renderOwned() {
    const box = $('owned');
    box.innerHTML = '';
    if (!state.owned.length) {
      box.appendChild(el('span', 'sub', '아직 없음'));
      return;
    }
    state.owned.forEach(id => {
      const a = E.AUG[id];
      const chip = el('span', 'chip r-' + a.rarity);
      chip.appendChild(img(a.icon));
      chip.appendChild(el('span', null, a.name));
      const x = el('button', 'x', '✕');
      x.title = '빼기';
      x.onclick = () => { state.owned = state.owned.filter(o => o !== id); save(); renderAll(); };
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  // ---------- 추천 아이템 ----------
  const ITEM_KEY = {};
  const squash = s => (s || '').replace(/[\s·:'’\-]/g, '');
  const ITEM_BY_ID = {};
  Object.keys(ITEMS).forEach(n => {
    ITEM_KEY[squash(n)] = ITEMS[n];
    const m = /(\d+)\.png$/.exec(ITEMS[n].icon);
    if (m) ITEM_BY_ID[m[1]] = ITEMS[n];
  });
  // 게임에서 읽은 내 아이템 (아이콘 경로로 비교)
  let myItems = new Set();
  let myItemIds = [];      // 내 인벤토리의 아이템 id (중복 포함)
  let myGold = null;       // 보유 골드 (게임에 연결됐을 때만)
  const ITEM_DB = window.ITEM_DB || {};
  const idOfIcon = icon => { const m = /(\d+)\.png$/.exec(icon || ''); return m ? m[1] : null; };
  // 목표 아이템을 완성하려면 얼마가 더 드는지, 빠진 하위 재료는 무엇인지 (이미 가진 재료는 뺀다)
  function plan(id, inv) {
    const it = ITEM_DB[id];
    if (!it) return { cost: 0, parts: [] };
    const i = inv.indexOf(id);
    if (i >= 0) { inv.splice(i, 1); return { cost: 0, parts: [] }; }
    let cost = it.base, parts = [];
    (it.from || []).forEach(f => {
      const sub = plan(f, inv);
      cost += sub.cost;
      if (sub.cost > 0) parts.push({ id: f, cost: sub.cost });
      parts = parts.concat(sub.parts.map(x => ({ ...x, deep: true })));
    });
    if (!(it.from || []).length) cost = it.cost;
    return { cost, parts };
  }
  // 지금 가진 돈으로 살 재료를 고른다: 돈을 가장 많이 쓰는(남는 돈이 가장 적은) 조합.
  // 큰 재료를 사면 그 아래 재료는 따로 살 필요가 없으므로 둘 중 하나만 고른다.
  function affordable(parts, gold) {
    const direct = parts.filter(x => !x.deep && ITEM_DB[x.id]);
    const deep = parts.filter(x => x.deep && ITEM_DB[x.id]);
    const best = list => {
      let top = { sum: 0, picks: [], val: 0 };
      const n = Math.min(list.length, 6);
      for (let m = 1; m < (1 << n); m++) {
        let sum = 0; const picks = [];
        for (let i = 0; i < n; i++) if (m & (1 << i)) { sum += list[i].cost; picks.push(list[i]); }
        // 다른 목표 템에도 들어가는 공용 재료에 가산점: 계획이 바뀌어도 버려지지 않는다
        const val = sum + picks.filter(q => (sharedParts.get(q.id) || []).length > 1).length * 150;
        if (sum <= gold && (val > top.val || (val === top.val && picks.length < top.picks.length))) top = { sum, picks, val };
      }
      return top;
    };
    const a = best(direct), b = best(deep);
    // 큰 재료를 우선하되, 하나도 못 사면 더 작은 재료에서 찾는다
    return (a.sum > 0 ? a : b).picks.sort((x, y) => y.cost - x.cost);
  }
  // 아이템 하나의 조합식에 들어가는 모든 재료 id (중간 재료 포함)
  function partsOf(id, acc) {
    acc = acc || new Set();
    ((ITEM_DB[id] || {}).from || []).forEach(f => { acc.add(f); partsOf(f, acc); });
    return acc;
  }
  let sharedParts = new Map();   // 재료 id → 그 재료가 들어가는 목표 템 이름들 (2개 이상이면 공용)
  const GOLD_PER_SEC = 8.5;     // 두리T: 가만히 있어도 초당 8.5골드
  const won = n => Math.round(n).toLocaleString('ko-KR') + 'G';
  const hasItem = name => { const i = itemInfo(name); return !!(i && myItems.has(i.icon)); };
  function itemInfo(name) { return ITEM_KEY[squash(name)] || ITEM_KEY[squash(ITEM_ALIAS[name])] || null; }
  // 주문력 챔피언에게 공격력 템, 공격력 챔피언에게 주문력 템은 보여 주지 않는다.
  function itemFits(name) {
    const info = itemInfo(name);
    const p = E.profile(state.champ, state.variant);
    if (!info || !p.known) return true;
    if (info.kind === 'ap') return p.traits.has('ap');
    if (info.kind === 'ad') return p.traits.has('ad');
    return true;
  }
  function itemRow(it, from) {
    const row = el('div', 'item-row' + (hasItem(it.name) ? ' have' : ''));
    const info = itemInfo(it.name);
    if (info) row.appendChild(img(info.icon, 'item-icon'));
    else row.appendChild(el('span', 'item-icon none', '🛒'));
    const t = el('div', 'item-text');
    t.appendChild(el('b', null, it.name));
    const sub = [hasItem(it.name) ? '✓ 구매함' : '', from ? '← ' + from : '', it.note || ''].filter(Boolean).join(' · ');
    if (sub) t.appendChild(el('span', 'sub', sub));
    row.appendChild(t);
    return row;
  }
  // 적 조합에 대응하는 아이템 (내 빌드 유형별)
  // 적 조합·적 아이템에 대응하는 템 (내 빌드 유형별). 위에 있을수록 먼저 추천.
  const SITUATION_ITEMS = {
    enemy_healers: { why: '적 회복 많음 → 치유 감소는 싼 재료로 충분 (두리T)', ap: ['망각의 구'], ad: ['처형인의 대검'], tank: [], video: 'Rch7F0vVQMc' },
    enemy_lifesteal: { why: '적 흡혈 템 → 치유 감소는 싼 재료로 충분 (두리T)', ap: ['망각의 구'], ad: ['처형인의 대검'], tank: [], video: 'Rch7F0vVQMc' },
    enemy_armor: { why: '적이 방어력 템 올림 → 퍼센트 관통 (두리T)', video: 'ZzPvW4E5vd4', ap: [], ad: ['도미닉 경의 인사', '세릴다의 원한'], tank: [] },
    enemy_mr: { why: '적이 마법 저항 템 올림 → 마법 관통', ap: ['공허의 지팡이'], ad: [], tank: [] },
    enemy_tanks: { why: '적 탱커 많음 → 퍼센트 관통 (두리T)', video: '-sdHN466lmE', ap: ['공허의 지팡이', '리안드리의 고통'], ad: ['도미닉 경의 인사', '몰락한 왕의 검'], tank: [] },
    enemy_hp: { why: '적 체력 템 많음 → 체력 비례 피해', ap: ['리안드리의 고통'], ad: ['몰락한 왕의 검'], tank: [] },
    enemy_ad: { why: '적 물리 피해 위주 → 방어력', ap: ['존야의 모래시계'], ad: ['수호 천사', '죽음의 무도'], tank: ['얼어붙은 심장', '란두인의 예언', '가시 갑옷'] },
    enemy_ap: { why: '적 마법 피해 위주 → 마법 저항', ap: ['밴시의 장막'], ad: ['맬모셔스의 아귀', '마법사의 최후'], tank: ['대자연의 힘', '정령의 형상', '망령의 두건'] },
    enemy_dive: { why: '적 돌진·암살 많음 → 생존', ap: ['존야의 모래시계'], ad: ['수호 천사', '불멸의 철갑궁'], tank: [] },
    enemy_cc: { why: '적 군중 제어 많음 → 강인함', ap: [], ad: [], tank: [] },   // 신발(헤르메스)에서 처리
    enemy_crit: { why: '적 치명타 빌드 → 치명타 피해 감소', ap: [], ad: [], tank: ['란두인의 예언'] },
    enemy_shields: { why: '적 보호막 많음', ap: [], ad: ['독사의 송곳니'], tank: [] },
  };
  // 챔피언 유형별 기본 템 (증강·조합과 무관하게 무난한 것)
  const BASE_ITEMS = {
    marksman_crit: ['무한의 대검', '루난의 허리케인', '고속 연사포', '도미닉 경의 인사', '피바라기', '유령 무희'],
    marksman_onhit: ['몰락한 왕의 검', '구인수의 격노검', '루난의 허리케인', '마법사의 최후', '내셔의 이빨', '크라켄 학살자'],
    mage: ['루덴의 메아리', '리안드리의 고통', '라바돈의 죽음모자', '그림자불꽃', '공허의 지팡이', '존야의 모래시계'],
    assassin_ap: ['폭풍 쇄도', '리치베인', '그림자불꽃', '라바돈의 죽음모자', '존야의 모래시계', '공허의 지팡이'],
    assassin_ad: ['요우무의 유령검', '오만', '세릴다의 원한', '밤의 끝자락', '독사의 송곳니', '죽음의 무도'],
    bruiser_ad: ['칠흑의 양날 도끼', '스테락의 도전', '갈라진 하늘', '죽음의 무도', '쇼진의 창', '거대한 히드라'],
    bruiser_ap: ['균열 생성기', '리안드리의 고통', '존야의 모래시계', '라바돈의 죽음모자', '공허의 지팡이', '영겁의 지팡이'],
    melee_crit: ['몰락한 왕의 검', '무한의 대검', '불멸의 철갑궁', '죽음의 무도', '유령 무희', '도미닉 경의 인사'],
    tank: ['강철심장', '태양불꽃 방패', '가시 갑옷', '정령의 형상', '얼어붙은 심장', '대자연의 힘', '워모그의 갑옷'],
    enchanter: ['월석 재생기', '불타는 향로', '흐르는 물의 지팡이', '구원', '새벽심장', '미카엘의 축복'],
  };
  // 신발 고르기 — 두리T: 신발은 내 약점을 메우는 도구. 신속·탐욕·헤르메스 중에서, 아이오니아는 비추천.
  function pickBoots(p, flags) {
    if (state.champ === 'Cassiopeia') return null;
    if (myItemIds.some(i => ((ITEM_DB[i] || {}).tags || []).includes('Boots') && (ITEM_DB[i].cost || 0) > 400)) return null;
    const tr = p.traits, c = p.classes[0];
    const slows = game ? game.enemies.filter(id => traitsOf(id).has('slow')).length : 0;
    const frontline = c === 'tank' || c === 'bruiser' || tr.has('melee');
    if (flags.includes('enemy_cc') && frontline) return { n: '헤르메스의 발걸음', why: '적 기절·속박 많음, 뚫고 들어가는 챔피언' };
    if (slows >= 3) return { n: '신속의 장화', why: '적 둔화 많음 → 둔화 저항' };
    if (c === 'mage' || (tr.has('ap') && tr.has('ranged') && c !== 'marksman')) {
      return (tr.has('dot') || tr.has('spellspam')) ? { n: '탐욕의 군화', why: '지속 피해·짧은 쿨 메이지 → 모든 피해 흡혈' } : { n: '신속의 장화', why: '메이지는 이속과 거리 조절이 중요' };
    }
    if (c === 'marksman' && tr.has('autoattack')) return { n: '광전사의 군화', why: '원딜은 공속 신발도 좋음' };
    if (flags.includes('enemy_cc')) return { n: '헤르메스의 발걸음', why: '적 기절·속박 많음' };
    return { n: '탐욕의 군화', why: '무난한 선택 — 처치 관여로 모든 피해 흡혈' };
  }
  function baseKey(p) {
    const c = p.classes[0], ap = p.traits.has('ap') && !p.traits.has('ad'), tr = p.traits;
    if (c === 'tank' || (tr.has('tankbuild') && !tr.has('ap') && !tr.has('ad'))) return 'tank';
    if (c === 'enchanter') return 'enchanter';
    if (c === 'marksman') return ap ? 'mage' : (tr.has('onhit') && !tr.has('crit')) ? 'marksman_onhit' : 'marksman_crit';
    if (c === 'mage') return 'mage';
    if ((c === 'bruiser' || c === 'assassin') && !ap && tr.has('crit') && tr.has('autoattack')) return 'melee_crit';   // 야스오·요네·트린다미어 등
    if (c === 'assassin') return ap ? 'assassin_ap' : 'assassin_ad';
    if (c === 'bruiser') return ap ? 'bruiser_ap' : 'bruiser_ad';
    return ap ? 'mage' : 'bruiser_ad';
  }
  // 살 아이템 목록: ① 가진 증강에 맞는 템(두리T 강의) ② 적 조합 대응 ③ 유형별 기본 템
  function buildList() {
    const p = E.profile(state.champ, state.variant);
    if (!p.known) return [];
    const out = [], seen = new Set();
    const add = (name, tag, why, needIcon) => {
      const info = itemInfo(name);
      if (needIcon && !info) return;             // 현재 패치에 없는 이름은 버린다
      if (!itemFits(name)) return;
      const key = info ? info.icon : name;
      if (seen.has(key)) { const e = out.find(x => x.key === key); if (e && why && e.tag === tag && !e.why.includes(why)) e.why += ', ' + why; return; }
      seen.add(key);
      out.push({ key, name, tag, why: why || '', have: hasItem(name), video: add.video || '' });
    };
    state.owned.forEach(id => ((E.K.augs[id] || {}).items || []).forEach(it => add(it.name, '증강', E.AUG[id].name + (it.note ? ' · ' + it.note : ''), false)));
    const kind = (p.traits.has('ap') && !p.traits.has('ad')) ? 'ap' : (p.traits.has('ad')) ? 'ad' : 'tank';
    const flags = situation();
    // 적 대응 템(최대 3개)과 기본 템을 섞는다: 기본 2개 → 대응 1개 → 기본 1개 → 대응 1개 …
    // 딜 템을 미루고 대응 템만 줄줄이 사는 일이 없도록 하기 위함.
    const isTank = baseKey(p) === 'tank';
    const sit = [];
    Object.keys(SITUATION_ITEMS).forEach(f => {
      if (!flags.includes(f)) return;
      const s = SITUATION_ITEMS[f];
      const n = ((isTank ? s.tank : s[kind]) || [])[0];
      if (n && itemInfo(n) && !sit.some(x => x.n === n)) sit.push({ n, why: s.why, video: s.video || '' });
    });
    // 핵심 템: op.gg 의 이 챔피언 빌드가 있으면 그걸 먼저, 모자라면 유형별 기본 템으로 채운다
    const og = ((E.K.champs[state.champ] || {}).opgg || {}).cores || [];
    const ogSeq = [];
    if (og.length) {
      og[0].forEach(n => { if (!ogSeq.includes(n)) ogSeq.push(n); });
      const freq = {};
      og.slice(1).forEach(row => row.forEach(n => { freq[n] = (freq[n] || 0) + 1; }));
      Object.keys(freq).sort((a, b) => freq[b] - freq[a]).forEach(n => { if (!ogSeq.includes(n)) ogSeq.push(n); });
    }
    const ogFit = ogSeq.filter(n => itemInfo(n) && itemFits(n));
    const useOg = ogFit.length >= 2;      // 지금 고른 빌드(주문력/공격력)와 맞을 때만
    const ogSet = new Set(useOg ? ogFit : []);
    const base = (useOg ? ogFit : []).concat((BASE_ITEMS[baseKey(p)] || []).filter(n => !ogSet.has(n)));
    const sitQ = sit.slice(0, 3);
    const boots = pickBoots(p, flags);
    const addSit = x => { add.video = x.video; add(x.n, '상황', x.why, true); add.video = ''; };
    let step = 0;
    while (base.length || sitQ.length) {
      if (step === 1 && boots) { add.video = 'P4wj_BnzaK4'; add(boots.n, '신발', boots.why + ' (두리T)', true); add.video = ''; }
      const wantSit = isTank ? step % 2 === 1 : (step >= 2 && step % 2 === 0);
      if (wantSit && sitQ.length) addSit(sitQ.shift());
      else if (base.length) { const n = base.shift(); add(n, ogSet.has(n) ? 'op.gg' : '기본', ogSet.has(n) ? 'op.gg 이 챔피언 핵심 빌드' : '', true); }
      else addSit(sitQ.shift());
      step++;
    }
    return out;
  }
  function tagEl(x) {
    const w = el('span', 'item-side');
    const v = videoLink(x.video); if (v) w.appendChild(v);
    w.appendChild(el('span', 'item-tag t-' + (x.tag === '증강' ? 'aug' : x.tag === '상황' ? 'sit' : x.tag === '신발' ? 'boot' : x.tag === 'op.gg' ? 'og' : 'base'), x.tag));
    return w;
  }
  function renderBuild() {
    const box = $('build');
    box.innerHTML = '';
    const list = buildList();
    $('buildBlock').hidden = !list.length;
    if (!list.length) return;
    // 정식 아이템 이름이 아닌 것(예: '마나 아이템')은 맨 뒤로
    const todo = list.filter(x => !x.have).sort((a, b) => !itemInfo(a.name) - !itemInfo(b.name)), done = list.filter(x => x.have);
    $('buildHead').textContent = myItems.size ? `구매 ${done.length} · 남음 ${todo.length}` : '증강 · 적 조합 · 챔피언 유형 기준';
    // 이미 하위 재료를 사 둔(만들던) 아이템을 맨 위로 올린다.
    // 재료는 추천 순서가 앞선 아이템에 먼저 배정해서, 같은 재료로 뒤 순서 템이 앞질러 올라오지 않게 한다.
    if (myItemIds.length) {
      const alloc = myItemIds.slice(), prog = new Map();
      todo.forEach(x => {
        const info = itemInfo(x.name), id = info ? idOfIcon(info.icon) : null;
        prog.set(x, (id && ITEM_DB[id] && ITEM_DB[id].cost) ? 1 - plan(id, alloc).cost / ITEM_DB[id].cost : 0);
      });
      const idx = new Map(todo.map((x, i) => [x, i]));
      todo.sort((a, b) => ((prog.get(b) > 0) - (prog.get(a) > 0)) || (idx.get(a) - idx.get(b)));
    }
    const idOf = x => { const info = itemInfo(x.name); const id = info ? idOfIcon(info.icon) : null; return id && ITEM_DB[id] && ITEM_DB[id].cost ? id : null; };
    // 앞으로 살 목표 4개의 재료를 모아, 겹치는 재료(공용)를 찾는다
    sharedParts = new Map();
    todo.slice(0, 4).forEach(x => {
      const id = idOf(x); if (!id) return;
      partsOf(id).forEach(f => { const l = sharedParts.get(f) || []; if (!l.includes(x.name)) l.push(x.name); sharedParts.set(f, l); });
    });
    // 맨 위 목표는 아직 못 사는데, 가진 재료 덕에 2~3순위 템을 지금 완성할 수 있으면 그걸 먼저 완성한다
    let finishFirst = null;
    if (myGold != null && todo.length > 1) {
      const costNow = x => { const id = idOf(x); return id ? plan(id, myItemIds.slice()).cost : Infinity; };
      if (costNow(todo[0]) > myGold) {
        const j = [1, 2].find(k => todo[k] && costNow(todo[k]) <= myGold && ITEM_DB[idOf(todo[k])].cost >= 2000);
        if (j) { finishFirst = todo[j]; todo.splice(j, 1); todo.unshift(finishFirst); }
      }
    }
    const inv = myItemIds.slice();     // 위에서부터 재료를 배정해, 같은 재료를 두 번 세지 않는다
    const buyNow = [];        // 지금 가진 돈으로 살 것 (맨 위 배너용)
    const sharedNote = (q, x) => (sharedParts.get(q.id) || []).length > 1;
    // 각 줄의 남은 금액·빠진 재료를 먼저 계산한다 (재료는 위 순서부터 배정)
    const rows = todo.slice(0, 7).map((x, i) => {
      const id = idOf(x);
      const pre = inv.slice();
      const pl = id ? plan(id, inv) : null;
      return { x, i, id, pre, pl };
    });
    // 맨 위 3개 목표를 함께 놓고, 지금 가진 돈으로 무엇을 사는 게 가장 좋은지 고른다.
    //  · 템 완성 > 재료  · 앞 순서 목표 > 뒤 순서  · 여러 템에 쓰이는 공용 재료 우대  · 남는 돈 최소
    const decide = new Map();
    let budget = myGold;
    if (myGold != null) {
      const cands = [];
      rows.slice(0, 3).forEach((r, k) => {
        if (!r.pl || r.pl.cost <= 0) return;
        const w = [1, 0.9, 0.8][k];
        cands.push({ k, full: true, cost: r.pl.cost, val: r.pl.cost * w + (ITEM_DB[r.id].cost >= 2000 ? 400 : 200) });
        r.pl.parts.filter(q => !q.deep && ITEM_DB[q.id]).forEach(q => {
          cands.push({ k, q, cost: q.cost, val: q.cost * w + ((sharedParts.get(q.id) || []).length > 1 ? 150 : 0) });
        });
      });
      const n = Math.min(cands.length, 12);
      let best = { val: 0, set: [] };
      for (let m = 1; m < (1 << n); m++) {
        let sum = 0, val = 0, ok = true; const set = [], fullK = new Set(), partK = new Set();
        for (let i = 0; i < n && ok; i++) if (m & (1 << i)) {
          const c = cands[i];
          sum += c.cost; val += c.val; set.push(c);
          if (c.full) fullK.add(c.k); else partK.add(c.k);
          if (sum > myGold) ok = false;
        }
        if (!ok || [...fullK].some(k => partK.has(k))) continue;
        if (val > best.val) best = { val, set };
      }
      // 큰 재료를 하나도 못 사면, 첫 목표의 더 작은 재료에서 찾는다
      if (!best.set.length && rows[0] && rows[0].pl) {
        best.set = affordable(rows[0].pl.parts, myGold).map(q => ({ k: 0, q, cost: q.cost }));
      }
      best.set.forEach(c => {
        const d = decide.get(c.k) || { full: false, picks: [] };
        if (c.full) d.full = true; else d.picks.push(c.q);
        decide.set(c.k, d);
        budget -= c.cost;
      });
      // 그래도 돈이 남으면, 아직 손대지 않은 목표의 더 작은 재료를 채운다 (앞 순서 목표부터)
      rows.slice(0, 2).forEach((r, k) => {
        if (budget < 250 || !r.pl || decide.has(k)) return;
        const small = r.pl.parts.filter(q => q.deep && ITEM_DB[q.id] && q.cost <= budget).sort((a, b) => b.cost - a.cost);
        const picks = []; let left = budget; const used = new Set();
        small.forEach(q => { if (q.cost <= left && !used.has(q.id)) { picks.push(q); used.add(q.id); left -= q.cost; } });
        if (picks.length) { decide.set(k, { full: false, picks }); budget = left; }
      });
    }
    rows.forEach(({ x, i, id, pre, pl }) => {
      const row = el('div', 'item-row' + (i < 3 ? ' next' : ''));
      const info = itemInfo(x.name);
      if (info) row.appendChild(img(info.icon, 'item-icon')); else row.appendChild(el('span', 'item-icon none', '🛒'));
      const t = el('div', 'item-text');
      t.appendChild(el('b', null, x.name));
      if (x.why) t.appendChild(el('span', 'sub', x.why));
      if (x === finishFirst) t.appendChild(el('span', 'gold can', '가진 재료로 지금 완성할 수 있어 먼저 올렸습니다'));
      if (id) {
        // 조합식: 가진 재료 ✓, 없는 재료는 가격, 다른 목표에도 쓰이는 재료는 "공용"
        if (i < 3 && (ITEM_DB[id].from || []).length) {
          const rec = el('div', 'recipe');
          ITEM_DB[id].from.forEach(f => {
            const fi = ITEM_DB[f]; if (!fi) return;
            const need = plan(f, pre).cost;
            const c = el('span', 'comp' + (need === 0 ? ' own' : need < fi.cost ? ' part' : ''));
            c.appendChild(img(fi.icon));
            const others = (sharedParts.get(f) || []).filter(nm => nm !== x.name);
            c.appendChild(el('span', null, fi.name + (need === 0 ? ' ✓' : ' ' + won(need))));
            if (others.length && need > 0) { c.appendChild(el('i', 'share', '공용')); c.title = others.join(', ') + ' 에도 들어갑니다'; }
            rec.appendChild(c);
          });
          if (ITEM_DB[id].base) rec.appendChild(el('span', 'comp fee', '조합비 ' + won(ITEM_DB[id].base)));
          t.appendChild(rec);
        }
        const total = ITEM_DB[id].cost;
        const line = pl.cost < total ? `${won(total)} · 남은 금액 ${won(pl.cost)}` : won(total);
        const g = el('span', 'gold', line);
        t.appendChild(g);
        const d = decide.get(i);
        if (d && d.full) {
          g.textContent = line + ' · 지금 완성';
          g.classList.add('can'); row.classList.add('buy');
          buyNow.push(`${x.name} 완성 ${won(pl.cost)}`);
        } else if (d && d.picks.length) {
          const txt = q => `${ITEM_DB[q.id].name} ${won(q.cost)}`;
          t.appendChild(el('span', 'gold can', '지금: ' + d.picks.map(q => txt(q) + (sharedNote(q) ? ` (공용: ${sharedParts.get(q.id).filter(nm => nm !== x.name).join(', ')}에도 씀)` : '')).join(' + ')));
          d.picks.forEach(q => buyNow.push(txt(q) + (sharedNote(q) ? ' (공용)' : '')));
        } else if (myGold != null && i < 3 && pl.cost > 0) {
          const lack = pl.cost - Math.max(0, budget);
          if (lack > 0) g.textContent = line + ` · ${won(lack)} 부족 (약 ${Math.ceil(lack / GOLD_PER_SEC / 5) * 5}초)`;
        }
      }
      row.appendChild(t);
      row.appendChild(tagEl(x));
      box.appendChild(row);
    });
    // 완성 템이 6개면 더 살 템이 없다 → 두리T: 남는 돈은 모루(750G)
    const full = myItemIds.filter(i => (ITEM_DB[i] || {}).cost >= 2000).length >= 6 || (myItemIds.filter(i => (ITEM_DB[i] || {}).cost >= 2000).length >= 5 && myItemIds.some(i => ((ITEM_DB[i] || {}).tags || []).includes('Boots')));
    if (full) {
      const d = el('div', 'buy-now');
      const pk = E.profile(state.champ, state.variant);
      d.appendChild(el('b', null, '템이 다 찼습니다 → 능력치 모루(750G, 9레벨부터)를 사세요'));
      d.appendChild(el('span', null, pk.traits.has('ad') && !pk.traits.has('ap') ? '공격력 챔피언은 퍼센트 방어구 관통을 최우선으로 (두리T)' : '필요한 능력치만 골라 받을 수 있습니다 (두리T)'));
      box.insertBefore(d, box.firstChild);
    } else
    if (myGold != null) {
      const start = game && game.time < 150 && !myItemIds.some(i => (ITEM_DB[i] || {}).cost >= 300);
      const b = el('div', 'buy-now' + (buyNow.length ? '' : ' wait'));
      b.appendChild(el('b', null, buyNow.length ? (start ? '시작 구매: ' : '지금 사세요: ') + buyNow.join(' + ') : `살 수 있는 게 없습니다. ${won(myGold)} 모으는 중`));
      if (buyNow.length) b.appendChild(el('span', null, `남는 돈 ${won(budget)}`));
      const st = (((E.K.champs[state.champ] || {}).opgg || {}).starters || [])[0];
      if (start && st && st.length) b.appendChild(el('span', 'og-start', 'op.gg 시작 템: ' + st.join(' + ')));
      box.insertBefore(b, box.firstChild);
    }
    if (done.length) box.appendChild(el('div', 'sub bought', '✓ 구매함: ' + done.map(x => x.name).join(', ')));
  }

  // ---------- 추천 카드 ----------
  function card(r, opts) {
    const a = r.aug;
    const c = el('div', 'card ' + r.grade + ' r-' + a.rarity + (opts.best ? ' best' : ''));
    const head = el('div', 'card-head');
    head.appendChild(img(a.icon, 'aug-icon'));
    const title = el('div', 'card-title');
    title.appendChild(el('div', 'name', a.name));
    title.appendChild(el('div', 'sub', (r.k.summary || a.desc || '').split('\n')[0]));
    head.appendChild(title);
    const sc = el('div', 'score');
    sc.appendChild(el('b', null, String(r.score)));
    sc.appendChild(el('span', null, r.label));
    head.appendChild(sc);
    c.appendChild(head);

    const key = (opts.prefix || '') + a.id;
    const expanded = opts.expanded || state.open[key];
    const body = el('div', 'card-body');
    const shown = expanded ? r.reasons : r.reasons.slice(0, opts.compact ? 0 : 3);
    shown.forEach(x => {
      const li = el('div', 'reason ' + x.t);
      li.appendChild(el('span', null, (x.t === 'good' ? '＋ ' : x.t === 'bad' ? '－ ' : '· ') + x.text));
      const v = videoLink(x.video);
      if (v) li.appendChild(v);
      body.appendChild(li);
    });
    const fitItems = (r.k.items || []).filter(t => itemFits(t.name));
    if (!expanded && opts.actions && fitItems.length) {
      body.appendChild(el('div', 'reason info', '🛒 집으면 갈 템: ' + fitItems.slice(0, 3).map(t => t.name + (hasItem(t.name) ? ' ✓' : '')).join(' · ')));
    }
    if (expanded) {
      if (a.desc) body.appendChild(el('div', 'desc', a.desc));
      (r.k.ctips || []).forEach(t => body.appendChild(el('div', 'tip', '🗣 ' + t.text + (t.source ? ` (${t.source})` : ''))));
      (r.k.tips || []).forEach(t => {
        const li = el('div', 'tip');
        li.appendChild(el('span', null, '💡 ' + t.text));
        const v = videoLink(t.video);
        if (v) li.appendChild(v);
        body.appendChild(li);
      });
      if ((r.k.items || []).length) {
        body.appendChild(el('div', 'tip-head', '이 증강을 집으면 맞춰 갈 아이템'));
        r.k.items.forEach(t => body.appendChild(itemRow(t)));
      }
      const champNames = list => (list || []).map(x => (CH[x.id] || {}).name).filter(Boolean);
      const g = champNames(r.k.goodChamps), b = champNames(r.k.badChamps);
      if (g.length) body.appendChild(el('div', 'tip', '👍 잘 맞는 챔피언: ' + g.join(', ')));
      if (b.length) body.appendChild(el('div', 'tip', '👎 안 맞는 챔피언: ' + b.join(', ')));
      const syn = (r.k.synergy || []).map(x => (E.AUG[x.id] || {}).name).filter(Boolean);
      if (syn.length) body.appendChild(el('div', 'tip', '🔗 같이 쓰면 좋은 증강: ' + syn.join(', ')));
    }
    c.appendChild(body);

    const foot = el('div', 'card-foot');
    const more = el('button', 'link', expanded ? '접기' : '자세히');
    more.onclick = () => { state.open[key] = !expanded; renderAll(); };
    if (!opts.expanded) foot.appendChild(more);
    if (opts.actions) {
      const rm = el('button', 'link', '빼기');
      rm.title = '잘못 넣었을 때';
      rm.onclick = () => { state.offered = state.offered.filter(o => o !== a.id); renderAll(); };
      foot.appendChild(rm);
      if (!canReroll(a.id)) foot.appendChild(el('span', 'sub', '새로고침으로 나온 카드'));
      if (canReroll(a.id)) {
        const rr = el('button', 'reroll' + (opts.rerollMe ? ' hot' : ''), '🔄 새로고침함');
        rr.title = '게임에서 이 증강을 새로고침했으면 누르고, 새로 나온 증강을 아래에서 고르세요';
        rr.onclick = () => {
          state.offered = state.offered.filter(o => o !== a.id);
          if (!state.seen.includes(a.id)) state.seen.push(a.id);
          pendingFresh++;
          save(); renderAll();
        };
        foot.appendChild(rr);
      }
      const take = el('button', 'take', '이걸 뽑음');
      take.onclick = () => { lastAuto = null; takeAugment(a.id); };
      foot.appendChild(take);
    }
    c.appendChild(foot);
    return c;
  }

  // 지금 상황을 점수 계산에 넘긴다: 조합 태그 + 이번이 몇 번째 선택인지
  // 팀 안에서 내 역할: 우리 팀 다른 4명의 구성을 보고 정한다
  function teamRole() {
    const p = E.profile(state.champ, state.variant);
    const src = game ? game.allies : (selectData ? selectData.team.map(x => (CH_BY_KEY[x.champ] || {}).id).filter(Boolean) : []);
    const mates = src.filter(id => id !== state.champ);
    const out = { roles: [], lines: [], mates };
    if (!p.known || mates.length < 2) return out;
    const tr = mates.map(traitsOf);
    const cnt = f => tr.filter(f).length;
    const isTank = t => t.has('tank') || t.has('tankbuild');
    const me = p.traits, cls = p.classes[0];
    const names = f => mates.filter(id => f(traitsOf(id))).map(id => CH[id].name);
    const tanks = cnt(isTank);
    if (tanks === 0 && (cls === 'tank' || cls === 'bruiser' || (me.has('melee') && me.has('tankbuild')))) {
      out.roles.push('frontline'); out.lines.push('우리 팀에 앞줄이 없습니다 → 내가 버텨야 합니다. 방어·회복 증강과 방어 템을 평소보다 높게 봅니다.');
    } else if (tanks === 0) {
      out.roles.push('nofront'); out.lines.push('우리 팀에 앞줄이 없습니다 → 적이 바로 닿습니다. 생존 수단을 하나는 챙기세요.');
    }
    const carries = names(t => t.has('marksman') || (t.has('mage') && !t.has('enchanter')));
    if ((cls === 'enchanter' || cls === 'tank') && carries.length) {
      out.roles.push('protect'); out.protect = carries;
      out.lines.push(`지켜 줄 딜러가 있습니다 (${carries.slice(0, 2).join(', ')}) → 아군을 강화·보호하는 증강의 가치가 높습니다.`);
    } else if (cls === 'enchanter' && !carries.length) {
      out.roles.push('nocarry'); out.lines.push('지켜 줄 원거리 딜러가 없습니다 → 아군 강화 증강보다 내 딜·생존 쪽이 낫습니다.');
    }
    if ((cls === 'marksman' || cls === 'mage') && tanks >= 1) {      // 앞줄이 있을 때만 (서폿만 있고 앞줄이 없으면 위의 '생존' 안내가 우선)
      out.roles.push('carry'); out.lines.push('앞줄이 있습니다 → 딜에 집중하는 증강을 골라도 됩니다.');
    }
    const ap = cnt(t => t.has('ap') && !t.has('ad')), ad = cnt(t => t.has('ad') && !t.has('ap'));
    if (ap === 0 && me.has('ap') && !me.has('ad')) { out.roles.push('sole_ap'); out.lines.push('팀에서 마법 피해는 나뿐입니다 → 딜을 포기하면 적이 방어력만 올리면 됩니다.'); }
    if (ad === 0 && me.has('ad') && !me.has('ap')) { out.roles.push('sole_ad'); out.lines.push('팀에서 물리 피해는 나뿐입니다 → 딜을 포기하면 적이 마법 저항만 올리면 됩니다.'); }
    if (cnt(t => t.has('cc')) <= 1 && me.has('cc')) { out.roles.push('sole_cc'); out.lines.push('팀의 군중 제어가 거의 나뿐입니다 → 스킬 가속·궁극기 증강이 팀에 도움이 됩니다.'); }
    return out;
  }
  // 내가 산 아이템이 주는 것 (치명타 템을 샀으면 치명타 증강이 살아난다)
  function itemTraits() {
    const out = new Set();
    const MAP = { CriticalStrike: 'crit', AttackSpeed: 'attackspeed', OnHit: 'onhit', AbilityHaste: 'haste', LifeSteal: 'heal_self', SpellVamp: 'heal_self' };
    myItemIds.forEach(i => { const it = ITEM_DB[i]; if (!it || (it.cost || 0) < 1000) return; (it.tags || []).forEach(t => { if (MAP[t]) out.add(MAP[t]); }); });
    return out;
  }
  const UPG_ALIAS = { '존야': '존야의 모래시계', '불사르기': '태양불꽃 방패' };
  // "○○ 업그레이드" 증강이 강화하는 아이템 이름
  function upgradeItemOf(aug) {
    const m = /^(.*?) ?업그레이드$/.exec(aug.name) || /^업그레이드: ?(.*)$/.exec(aug.name);
    if (!m) return null;
    const n = UPG_ALIAS[m[1]] || m[1];
    return itemInfo(n) ? n : null;
  }
  // 증강과 내 아이템의 궁합: 가진 템·계획한 템과 맞으면 가산, 빌드와 안 맞거나 템 칸이 없으면 감점
  function makeItemAdjust() {
    const p = E.profile(state.champ, state.variant);
    if (!p.known) return null;
    const plan = new Set(buildList().slice(0, 7).map(x => x.key));
    const keyOf = n => { const i = itemInfo(n); return i ? i.icon : n; };
    const done = myItemIds.filter(i => (ITEM_DB[i] || {}).cost >= 2000).length;
    const live = myGold != null;          // 게임에 연결돼 내 아이템을 알 때만 "가진 템" 판단을 한다
    const role = teamRole();
    return (aug, k) => {
      let add = 0; const reasons = [];
      // 팀 안에서의 내 역할
      const gives = k.gives || [], tags = aug.tags || [];
      const defensive = tags.includes('resilience') || gives.some(g => g === 'tankbuild' || g === 'shield' || g === 'heal_self' || g === 'revive');
      const allyBuff = tags.includes('ally') || gives.includes('heal_ally');
      const damage = tags.includes('damage');
      if (role.roles.includes('frontline') && defensive) { add += 6; reasons.push({ t: 'good', text: '팀에 앞줄이 없어 내가 버텨야 함 → 방어·회복 증강' }); }
      if (role.roles.includes('nofront') && defensive) { add += 3; reasons.push({ t: 'good', text: '팀에 앞줄이 없음 → 생존 수단' }); }
      if (role.roles.includes('protect') && allyBuff) { add += 6; reasons.push({ t: 'good', text: `지켜 줄 딜러가 있음 (${role.protect.slice(0, 2).join(', ')})` }); }
      if (role.roles.includes('nocarry') && allyBuff) { add -= 5; reasons.push({ t: 'bad', text: '강화해 줄 원거리 딜러가 팀에 없음' }); }
      if (role.roles.includes('carry') && damage && !defensive) { add += 3; reasons.push({ t: 'good', text: '앞줄이 있어 딜에 집중해도 됨' }); }
      if ((role.roles.includes('sole_ap') || role.roles.includes('sole_ad')) && damage) { add += 3; reasons.push({ t: 'good', text: role.roles.includes('sole_ap') ? '팀의 유일한 마법 딜러' : '팀의 유일한 물리 딜러' }); }
      if (role.roles.includes('sole_cc') && (gives.includes('haste') || gives.includes('ult') || gives.includes('cc'))) { add += 3; reasons.push({ t: 'good', text: '팀의 군중 제어를 내가 맡음' }); }
      const up = upgradeItemOf(aug);
      if (up) {
        if (live && hasItem(up)) { add += 10; reasons.push({ t: 'good', text: `이미 가진 「${up}」이(가) 강화됨` }); }
        else if (!itemFits(up)) { add -= 15; reasons.push({ t: 'bad', text: `「${up}」은(는) 내 빌드와 안 맞는 템` }); }
        else if (plan.has(keyOf(up))) { add += 6; reasons.push({ t: 'good', text: `살 예정인 「${up}」과 맞음` }); }
        else if (live && done >= 5) { add -= 8; reasons.push({ t: 'bad', text: `템 칸이 거의 차서 「${up}」을(를) 새로 넣기 어려움` }); }
      }
      const its = (k.items || []).filter(t => itemFits(t.name) && itemInfo(t.name));
      if (live && its.length) {
        const own = its.filter(t => hasItem(t.name));
        if (own.length) { add += Math.min(8, 4 * own.length); reasons.push({ t: 'good', text: `이미 가진 템과 맞음: ${own.slice(0, 2).map(t => t.name).join(', ')}` }); }
        else if (done >= 5 && !its.some(t => plan.has(keyOf(t.name)))) { add -= 5; reasons.push({ t: 'bad', text: '맞춰 갈 템을 새로 살 칸이 없음' }); }
      }
      return { add, reasons };
    };
  }
  function curCtx() { return { flags: situation(), round: state.rounds.length, extraGives: itemTraits(), itemAdjust: makeItemAdjust() }; }
  // 한 판의 증강 선택 횟수 (열혈 팬은 21레벨에 한 번 더)
  function totalRounds() { return 4 + (state.headliner === 'worlds' ? 1 : 0); }

  // ---------- 헤드라이너: 판마다 하나씩 정해지는 특별 규칙 ----------
  const HEADS = window.HEADLINERS || {};
  // 규칙별로 플레이·증강 선택이 어떻게 달라지는지 (규칙 설명에서 따라 나오는 것만)
  const HEAD_TIPS = {
    commandline: '선택지가 실버·골드로만 나오고, 카드 한 장을 한 등급 위로 바꾸는 금빛 새로고침이 있습니다. 가장 안 좋은 카드 한 장에 꼭 쓰세요. 나머지 카드는 일반 새로고침입니다.',
    worlds: '21레벨에 증강을 하나 더 받습니다. 판이 길어지므로 쌓일수록 강해지는 증강의 가치가 올라갑니다.',
    pentakill: '기본 스킬 하나가 강화됩니다(스킬 가속 +20, 피해·회복 +10%). 가장 자주 쓰는 주력 스킬을 고르세요. 18레벨에 하나 더 고릅니다.',
    kda: '포토카드 4장을 모으면 증강을 하나 더 받습니다. 카드가 떨어지면 무리하지 않는 선에서 챙기세요.',
    heartsteel: '스티커가 붙은 증강은 추가 효과가 있습니다. 점수가 비슷하면 스티커 붙은 쪽이 낫습니다.',
    truedamage: '다중 킬·제압·포탑 파괴로 모루를 받습니다. 한타에서 이기는 조합일수록 이득이 큽니다.',
    bees: '꿀은 골드와 체력을 줍니다(대형 100골드·30% 회복). 벌에 닿으면 최대 체력 비례 피해를 입으니 피하세요.',
    cafecuties: '체력 유물이 더 많이 회복시키고 이동 속도도 줍니다. 유물 주변에서 싸우는 쪽이 유리합니다.',
    disco: '디스코 볼이 떨어질 때까지 무대에서 춤추면 모두 1,000골드를 받습니다. 빠지지 말고 참여하세요.',
  };
  const EXTRA_HEADS = {
    maestro: { name: '마에스트로', short: '증강 4개 중 하나를 선택합니다!', desc: '증강 선택지가 3개가 아니라 4개 나옵니다.' },
    arcade: { name: '아케이드', short: '토큰을 모아 부활하세요!', desc: '처치에 관여하면 토큰을 얻습니다. 죽어 있는 동안 토큰 4개를 써서 바로 부활할 수 있습니다.' },
    debonair: { name: '연미복', short: '증강이 추가 골드를 줍니다!', desc: '증강 선택지마다 추가 골드가 붙어 있습니다.' },
    lailusion: { name: '망자의 환영', short: '양초를 주워 보호막을 얻으세요!', desc: '아군이 죽으면 가까운 아군 근처에 양초가 생깁니다. 주우면 자신과 주변 아군이 보호막을 얻습니다.' },
  };
  const headNames = new Set(Object.values(HEADS).map(h => h.name));
  Object.keys(EXTRA_HEADS).forEach(id => { if (!headNames.has(EXTRA_HEADS[id].name)) HEADS[id] = EXTRA_HEADS[id]; });
  Object.assign(HEAD_TIPS, {
    maestro: '선택지가 4장이라 좋은 증강이 나올 가능성이 높습니다. 카드마다 새로고침도 한 번씩 됩니다.',
    arcade: '토큰 4개로 즉시 부활할 수 있습니다. 한타 중에 죽었을 때 쓰면 수적 우위를 되찾습니다.',
    debonair: '카드마다 붙은 골드가 다릅니다. 점수가 비슷하면 골드가 많은 쪽을 고르세요.',
    lailusion: '아군이 죽으면 양초가 생깁니다. 주워서 보호막을 받고 싸움을 이어 가세요.',
  });
  if (state.headliner && !HEADS[state.headliner]) state.headliner = null;
  function setHeadliner(id) { if (state.headliner !== id) { state.headliner = id; save(); renderAll(); } }
  // 화면에서 읽은 글자로 규칙을 알아낸다: 규칙 이름·소개 문구, 또는 "금빛 새로고침"(커맨드 라인)
  function detectHeadliner(items) {
    if (state.headliner) return;
    const sqz = t => (t || '').replace(/[\s!?,.'’:·\-]/g, '');
    for (const it of items) {
      const t = sqz(it.t);
      if (!t) continue;
      if (t === '금빛새로고침' || t.includes('새로고침시한등급높은증강')) return setHeadliner('commandline');
      for (const id of Object.keys(HEADS)) {
        const h = HEADS[id];
        if (h.short && t.includes(sqz(h.short))) return setHeadliner(id);
        // 이름만으로는 스킨 이름과 겹칠 수 있어, 게임 시작 직후에만 인정한다
        if (game && game.time < 90 && t === sqz(h.name)) return setHeadliner(id);
      }
    }
  }
  function renderHeadliner(box) {
    const d = el('div', 'headliner');
    if (state.headliner) {
      const h = HEADS[state.headliner];
      const top = el('div', 'head-top');
      top.appendChild(el('b', null, '이번 판 규칙: ' + h.name));
      const x = el('button', 'link', '바꾸기');
      x.onclick = () => { state.headliner = null; save(); renderAll(); };
      top.appendChild(x);
      d.appendChild(top);
      d.appendChild(el('span', null, h.desc.split('\n')[0]));
      if (HEAD_TIPS[state.headliner]) d.appendChild(el('span', 'head-tip', '→ ' + HEAD_TIPS[state.headliner]));
    } else {
      d.appendChild(el('span', 'sub', '이번 판 규칙(헤드라이너)을 고르세요 — 게임 시작 때 화면에 뜨면 자동으로 잡힙니다'));
      const chips = el('div', 'chips');
      Object.keys(HEADS).forEach(id => {
        const b = el('button', 'chip-btn', HEADS[id].name);
        b.title = HEADS[id].short;
        b.onclick = () => setHeadliner(id);
        chips.appendChild(b);
      });
      d.appendChild(chips);
    }
    box.appendChild(d);
  }

  // ---------- 등급 기록: 판마다 몇 번째 선택에 어떤 등급이 나왔는지 쌓는다 ----------
  // 등급은 매 선택마다 무작위이고 10명 모두 같다. 공개된 확률이 없어 내 판에서 직접 센다.
  const HIST_KEY = 'augHistory';
  function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }
  function saveHist(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-300))); } catch (e) { /* 무시 */ } }
  if (!state.rounds) state.rounds = [];
  function recordRound(pickedId, offered) {
    state.rounds.push({ rarity: E.AUG[pickedId].rarity, picked: pickedId, offered: offered.slice(), level: game ? game.level : null });
  }
  function closeGame() {          // 판이 끝나면(새 판 시작 시) 기록을 보관한다
    if (state.rounds && state.rounds.length) {
      const h = loadHist();
      h.push({ ts: Date.now(), champ: state.champ, headliner: state.headliner || null, rounds: state.rounds });
      saveHist(h);
    }
    state.rounds = [];
  }
  // n번째 선택(0부터)에 각 등급이 나온 비율. 5판 이상 쌓여야 보여 준다.
  function rarityStats(n) {
    const c = { silver: 0, gold: 0, prismatic: 0 }; let total = 0;
    loadHist().forEach(g => { const rd = (g.rounds || [])[n]; if (rd && c[rd.rarity] != null) { c[rd.rarity]++; total++; } });
    if (total >= 5) return { total, mine: true, pct: { silver: c.silver / total, gold: c.gold / total, prismatic: c.prismatic / total } };
    // 공식 확률표는 없다. 통계 사이트 ARAMKit 의 관측치: 첫 선택은 골드가 많고, 이후는 실버 30 / 골드 45 / 프리즘 25 안팎
    const pct = n === 0 ? { silver: 0.119, gold: 0.604, prismatic: 0.277 } : { silver: 0.30, gold: 0.45, prismatic: 0.25 };
    if (state.headliner === 'commandline') return { total: 0, mine: false, pct: { silver: 0.4, gold: 0.6, prismatic: 0 }, note: '커맨드 라인 판은 실버·골드만 나옵니다' };
    return { total: 0, mine: false, pct };
  }

  // 증강을 뽑은 것으로 기록한다
  function takeAugment(id) {
    recordRound(id, state.offered.length ? state.offered : [id]);
    if (!state.owned.includes(id)) state.owned.push(id);
    state.offered.forEach(o => { if (o !== id && !state.seen.includes(o)) state.seen.push(o); });
    state.offered = [];
    state.fresh = []; pendingFresh = 0;
    autoOffered = false; awaitPick = false; lastRow = ''; sameCount = 0; emptyCount = 0; lastHover = null;
    state.open = {};
    save(); renderAll();
  }
  // 자동으로 기록한 선택이 틀렸을 때 바꿔 준다
  function renderAutoNotice(box) {
    if (!lastAuto || !state.owned.includes(lastAuto.id)) return;
    const d = el('div', 'verdict take');
    d.appendChild(el('b', null, `「${E.AUG[lastAuto.id].name}」 뽑은 것으로 넣었습니다`));
    if (lastAuto.others.length) {
      const line = el('span', null, '다른 걸 뽑았다면: ');
      lastAuto.others.forEach(o => {
        const b = el('button', 'link swap', E.AUG[o].name);
        b.onclick = () => {
          state.owned = state.owned.filter(x => x !== lastAuto.id);
          state.seen = state.seen.filter(x => x !== o);
          if (!state.seen.includes(lastAuto.id)) state.seen.push(lastAuto.id);
          state.owned.push(o);
          const lr = state.rounds[state.rounds.length - 1]; if (lr) { lr.picked = o; lr.rarity = E.AUG[o].rarity; }
          lastAuto = null; save(); renderAll();
        };
        line.appendChild(b);
      });
      d.appendChild(line);
    }
    box.appendChild(d);
  }

  // 다음 선택 화면이 뜨기 전에: 등급별로 "나오면 집을 증강"을 미리 보여 준다
  function renderTargets(box) {
    const out = new Set([...state.owned, ...state.seen]);
    const wrap = el('div', 'targets');
    const RK = { prismatic: '프리즘', gold: '골드', silver: '실버' };
    const nth = state.rounds.length;           // 다음이 몇 번째 선택인지
    wrap.appendChild(el('div', 'targets-head', `다음에 나오면 집을 증강 (${nth + 1}번째 선택)`));
    if (state.rounds.length) {
      const line = el('div', 'round-line');
      line.appendChild(el('span', 'sub', '이번 판 등급:'));
      state.rounds.forEach((rd, i) => line.appendChild(el('span', 'round-chip r-txt-' + rd.rarity, `${i + 1}번째 ${RK[rd.rarity]}`)));
      line.appendChild(el('span', 'sub', '· 등급은 10명 모두 같습니다'));
      wrap.appendChild(line);
    }
    const st = rarityStats(nth);
    let order = ['prismatic', 'gold', 'silver'];
    if (st) order = order.slice().sort((x, y) => st.pct[y] - st.pct[x]);     // 내 기록상 자주 나온 등급을 위로
    order.forEach(rar => {
      const ids = AUGS.filter(a => a.rarity === rar && !out.has(a.id)).map(a => a.id);
      const top = E.rank(ids, state.champ, state.variant, state.owned, curCtx()).slice(0, 4);
      if (!top.length) return;
      const row = el('div', 'target-row');
      const lab = el('span', 'target-rar r-txt-' + rar, RK[rar]);
      if (st && !(st.note && rar !== 'prismatic')) { lab.appendChild(el('small', null, Math.round(st.pct[rar] * 100) + '%')); lab.title = st.mine ? `내 기록 ${st.total}판에서 ${nth + 1}번째 선택에 이 등급이 나온 비율` : '통계 사이트 관측치 (공식 수치 아님)'; }
      row.appendChild(lab);
      const chips = el('div', 'chips');
      top.forEach(r => {
        const c = el('span', 'chip r-' + rar + ' ' + r.grade);
        c.title = (r.k.summary || r.aug.desc || '') + '\n' + r.reasons.map(x => (x.t === 'bad' ? '－ ' : '＋ ') + x.text).join('\n');
        c.appendChild(img(r.aug.icon));
        c.appendChild(el('span', null, r.aug.name));
        c.appendChild(el('b', 'target-score', String(r.score)));
        chips.appendChild(c);
      });
      row.appendChild(chips);
      wrap.appendChild(row);
    });
    const hn = loadHist().length;
    wrap.appendChild(el('div', 'sub', st.note ? st.note : st.mine ? `등급 옆 숫자는 내 기록 ${st.total}판 기준입니다.` : `등급 옆 숫자는 통계 사이트 관측치입니다(공식 아님). 내 기록이 5판 쌓이면 그걸로 바뀝니다. (지금 ${hn}판)`));
    box.appendChild(wrap);
  }

  function renderResults() {
    const box = $('results');
    box.innerHTML = '';
    $('clearOffered').hidden = !state.offered.length;
    if (state.champ && (game || state.headliner || HELPER === false)) renderHeadliner(box);
    if (!state.champ) {
      box.appendChild(el('div', 'empty', '먼저 위에서 챔피언을 고르세요. (게임 중이면 자동으로 잡힙니다)'));
      return;
    }
    if (!state.offered.length) {
      renderAutoNotice(box);
      renderTargets(box);
      box.appendChild(el('div', 'empty small', HELPER === false ? '아래 목록에서 게임 화면에 나온 증강을 누르세요. (등급 버튼으로 좁히면 빨리 찾습니다)' : state.autoScan ? '증강 선택 화면이 뜨면 자동으로 채워집니다. (직접 넣으려면 아래 목록에서 누르기)' : '아래에서 화면에 나온 증강을 누르세요.'));
      return;
    }
    const ranked = E.rank(state.offered, state.champ, state.variant, state.owned, curCtx());
    // 앞을 내다보기: 이 카드를 집으면 남은 선택에서 기대할 수 있는 증강이 얼마나 좋아지는지를 점수에 더한다
    const remaining = Math.max(0, totalRounds() - state.rounds.length - 1);
    if (remaining > 0) {
      const la = E.lookahead(state.offered, state.champ, state.variant, state.owned, {
        excluded: new Set([...state.owned, ...state.seen, ...state.offered]),
        remaining, odds: n => rarityStats(n).pct, k: state.offered.length >= 4 ? 6 : 5, ctx: curCtx(),
      });
      ranked.forEach(r => {
        const f = la[r.id]; if (!f) return;
        const add = Math.max(-12, Math.min(12, Math.round(f.delta)));
        r.now = r.score; r.future = add;
        if (add !== 0) {
          r.score = Math.max(1, Math.min(99, r.score + add));
          r.label = r.score >= 85 ? '강력 추천' : r.score >= 70 ? '추천' : r.score >= 55 ? '무난' : r.score >= 40 ? '애매' : '비추천';
          r.grade = r.score >= 85 ? 'g5' : r.score >= 70 ? 'g4' : r.score >= 55 ? 'g3' : r.score >= 40 ? 'g2' : 'g1';
        }
        const names = f.partners.map(x => `「${E.AUG[x.id].name}」`).join(' ');
        if (add >= 1) r.reasons.unshift({ t: 'good', text: `앞을 내다보면 +${add}: 남은 선택 ${remaining}번에서 이 증강과 맞는 게 나올 확률 약 ${Math.round(f.anyP * 100)}%` + (names ? ` (${names})` : '') });
        else if (add <= -1) r.reasons.unshift({ t: 'bad', text: `앞을 내다보면 ${add}: 이걸 집으면 이후 좋은 증강의 선택지가 줄어듦` });
      });
      ranked.sort((a, b) => b.score - a.score);
    }
    const adv = rerollAdvice(ranked);
    if (awaitPick) { adv.kind = 'wait'; adv.title = '무엇을 뽑으셨나요?'; adv.detail = '뽑은 증강의 「이걸 뽑음」을 한 번만 눌러 주세요.'; }
    ranked.forEach((r, i) => box.appendChild(card(r, {
      actions: true,
      best: i === 0 && ranked.length > 1 && adv.kind !== 'reroll',
      rerollMe: adv.kind === 'reroll' && r.id === adv.target,
    })));
    const v = el('div', 'verdict ' + adv.kind);
    v.appendChild(el('b', null, adv.title));
    if (adv.detail) v.appendChild(el('span', null, adv.detail));
    box.insertBefore(v, box.firstChild);
  }

  // 새로고침 판단: 같은 등급에서 아직 안 나온 증강들과 비교한다.
  // 강의 원칙 — 원하는 게 떴으면 바로 집고, 한 번 뜬 증강은 그 판에 다시 안 나온다.
  function rerollAdvice(ranked) {
    const best = ranked[0];
    const worst = ranked.slice().reverse().find(x => canReroll(x.id)) || ranked[ranked.length - 1];
    const UP = { silver: 'gold', gold: 'prismatic', prismatic: 'prismatic' };
    // 커맨드 라인: 이번 선택의 첫 새로고침은 버리는 카드보다 한 등급 위가 나온다
    const left = rerollsLeft();
    const golden = state.headliner === 'commandline' && state.fresh.length === 0 && worst.aug.rarity !== 'prismatic';
    const rarity = golden ? UP[worst.aug.rarity] : worst.aug.rarity;   // 새로 나올 증강의 등급
    const out = new Set([...state.owned, ...state.seen, ...state.offered]);
    const pool = AUGS.filter(a => a.rarity === rarity && !out.has(a.id)).map(a => E.score(a.id, state.champ, state.variant, state.owned, curCtx()).score);
    const better = pool.length ? pool.filter(x => x > best.score + 3).length / pool.length : 0;
    const pct = Math.round(better * 100);
    const name = r => `「${r.aug.name}」`;
    if (ranked.length < 3) {
      return { kind: 'wait', title: `지금까지는 ${name(best)}`, detail: '나머지 증강도 넣으면 새로고침 여부까지 판단합니다.' };
    }
    if (golden && left > 0) {
      // 등급이 오르는 새로고침은 손해 볼 일이 거의 없다: 가장 안 좋은 카드는 돌린다
      return {
        kind: 'reroll', target: worst.id,
        title: `${name(worst)} 새로고침 (커맨드 라인: ${RAR[rarity]} 등급으로 상승)`,
        detail: `첫 새로고침은 한 등급 위가 나옵니다. 새로 뽑으면 ${name(best)}보다 나은 게 나올 확률이 약 ${pct}%입니다. 안 나오면 ${name(best)}를 집으세요.`,
      };
    }
    if (best.score >= 80 || better <= 0.12) {
      return { kind: 'take', title: `${name(best)} 바로 집으세요`, detail: best.score >= 80 ? '충분히 좋은 증강입니다. 원하는 게 떴으면 새로고침하지 않는 게 두리T 원칙입니다.' : `${RAR[rarity]} 등급에서 이보다 나은 증강이 거의 안 남았습니다.` };
    }
    if (left <= 0) {
      return { kind: 'take', title: `그나마 ${name(best)}`, detail: '새로고침을 다 썼습니다. 남은 것 중에서는 이게 가장 낫습니다.' };
    }
    return {
      kind: 'reroll', target: worst.id,
      title: `${name(worst)} 새로고침 추천`,
      detail: `모두 아쉽습니다. 새로 뽑으면 ${name(best)}보다 나은 게 나올 확률이 약 ${pct}%입니다 (새로고침 가능한 카드 ${left}장). 안 나오면 ${name(best)}를 집으세요.`,
    };
  }
  const RAR = { silver: '실버', gold: '골드', prismatic: '프리즘' };

  // ---------- 증강 고르는 격자 ----------
  function renderGrid() {
    const box = $('grid');
    box.innerHTML = '';
    const list = AUGS.filter(a =>
      (state.rarity === 'all' || a.rarity === state.rarity) &&
      E.matches(state.q, a.name, a.en) &&
      !state.owned.includes(a.id) && !state.offered.includes(a.id));
    list.sort((x, y) => x.name.localeCompare(y.name, 'ko'));
    list.forEach(a => {
      const wasSeen = state.seen.includes(a.id);
      const b = el('button', 'cell r-' + a.rarity + (wasSeen ? ' seen' : ''));
      b.title = (wasSeen ? '[이번 판에 이미 나온 증강] ' : '') + (a.desc || a.name);
      b.appendChild(img(a.icon));
      b.appendChild(el('span', null, a.name));
      b.onclick = () => {
        state.seen = state.seen.filter(x => x !== a.id);
        if (state.target === 'owned') {
          state.owned.push(a.id);
        } else {
          if (state.offered.length >= MAX_OFFER) state.offered.shift();
          state.offered.push(a.id);
          if (pendingFresh > 0) { pendingFresh--; if (!state.fresh.includes(a.id)) state.fresh.push(a.id); }
        }
        if (state.q) { state.q = ''; $('search').value = ''; }
        save(); renderAll();
      };
      box.appendChild(b);
    });
    if (!list.length) box.appendChild(el('div', 'empty', '찾는 증강이 없습니다.'));
  }

  // ---------- 전체 순위 ----------
  function renderRank() {
    const box = $('rankList');
    box.innerHTML = '';
    if (!state.champ) { box.appendChild(el('div', 'empty', '챔피언을 고르면 이 챔피언 기준 순위가 나옵니다.')); return; }
    const ids = AUGS.filter(a => state.rankRarity === 'all' || a.rarity === state.rankRarity).map(a => a.id).filter(id => !state.owned.includes(id));
    E.rank(ids, state.champ, state.variant, state.owned, curCtx()).forEach(r => box.appendChild(card(r, { compact: true, prefix: 'rank:' })));
  }

  // ---------- 강의 노트 ----------
  function renderNotes() {
    const box = $('noteList');
    box.innerHTML = '';
    const q = $('noteSearch').value;
    const notes = (E.K.general || []).filter(n => E.matches(q, n.topic, n.text));
    if (!notes.length) { box.appendChild(el('div', 'empty', '노트가 없습니다.')); return; }
    notes.forEach(n => {
      const d = el('div', 'note');
      d.appendChild(el('b', null, n.topic));
      d.appendChild(el('p', null, n.text));
      const v = videoLink(n.video);
      if (v) d.appendChild(v);
      box.appendChild(d);
    });
  }

  function renderAll() {
    $('rrCount').textContent = state.offered.length ? rerollsLeft() + '장' : '카드마다 1번';
    renderTop(); renderSelect(); renderSituation(); renderOwned(); renderBuild(); renderResults(); renderGrid();
    ['offerBlock', 'pickerBlock'].forEach(b => { $(b).style.display = selectData ? 'none' : ''; });
    if (!$('tab-rank').hidden) renderRank();
    if (!$('tab-notes').hidden) { renderSitNotes(); renderNotes(); }
  }

  // ---------- 챔피언 고르기 ----------
  function renderChampGrid() {
    const box = $('champGrid');
    box.innerHTML = '';
    const q = $('champSearch').value;
    CHAMPS.filter(c => E.matches(q, c.name, c.en, c.id)).forEach(c => {
      const b = el('button', 'cell');
      b.appendChild(img(c.icon));
      b.appendChild(el('span', null, c.name));
      b.onclick = () => { setChamp(c.id); $('champModal').hidden = true; };
      box.appendChild(b);
    });
  }
  function setChamp(id) {
    if (state.champ !== id) { state.champ = id; state.variant = 0; }
    save(); renderAll();
  }

  // ---------- 이벤트 ----------
  function seg(id, attr, cb) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      [...$(id).children].forEach(x => x.classList.toggle('on', x === b));
      cb(b.dataset[attr]);
    });
  }
  seg('targetSeg', 'target', v => { state.target = v; });
  seg('raritySeg', 'r', v => { state.rarity = v; renderGrid(); });
  seg('rankRaritySeg', 'r', v => { state.rankRarity = v; renderRank(); });
  $('search').addEventListener('input', e => { state.q = e.target.value; renderGrid(); });
  $('noteSearch').addEventListener('input', renderNotes);
  $('clearOffered').onclick = () => { state.offered = []; renderAll(); };
  $('champBtn').onclick = () => { $('champModal').hidden = false; $('champSearch').value = ''; renderChampGrid(); };
  $('champClose').onclick = () => { $('champModal').hidden = true; };
  $('champSearch').addEventListener('input', renderChampGrid);
  $('settingsBtn').onclick = () => { $('settings').hidden = !$('settings').hidden; };
  $('resetGame').onclick = () => { newGame(); save(); renderAll(); };
  function newGame() { lastAuto = null; variantManual = false; myItems = new Set(); myItemIds = []; newGameState(); }
  function newGameState() { closeGame(); state.headliner = null; state.owned = []; state.offered = []; state.seen = []; state.open = {}; state.fresh = []; pendingFresh = 0; }
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    ['pick', 'rank', 'notes'].forEach(t => { $('tab-' + t).hidden = t !== b.dataset.tab; });
    renderAll();
  });
  function applyOpacity() {
    try { window.webkit.messageHandlers.native.postMessage({ type: 'opacity', value: state.opacity / 100 }); } catch (e) { /* 브라우저에서 열었을 때 */ }
  }
  $('opacity').value = state.opacity;
  $('opacity').addEventListener('input', e => { state.opacity = +e.target.value; applyOpacity(); save(); });
  applyOpacity();
  // 자동 인식을 끄면 앱이 게임 쪽 주소를 아예 읽지 않는다.
  function applyLive() {
    try { window.webkit.messageHandlers.native.postMessage({ type: 'live', value: !!state.live }); } catch (e) { /* 브라우저 */ }
    if (!state.live) $('liveInfo').textContent = '';
  }
  $('liveToggle').checked = !!state.live;
  $('liveToggle').addEventListener('change', e => { state.live = e.target.checked; applyLive(); save(); });
  applyLive();

  // ---------- 게임에서 내 챔피언 자동으로 읽기 ----------
  // 맥 앱이 3초마다 라이엇 공식 로컬 주소에서 읽어 넘겨 준다. 게임 중이 아니면 null.
  let wasLive = false;
  let variantManual = false;
  // 산 아이템을 보고 주문력/공격력 빌드를 맞춘다 (직접 고른 뒤에는 건드리지 않음)
  function autoVariant() {
    if (variantManual || !state.champ) return;
    const c = E.K.champs[state.champ];
    if (!c || !c.alt || !c.alt.length) return;
    let ap = 0, ad = 0;
    Object.values(ITEMS).forEach(i => { if (myItems.has(i.icon)) { if (i.kind === 'ap') ap++; else if (i.kind === 'ad') ad++; } });
    if (ap + ad < 1 || ap === ad) return;
    const want = ap > ad ? 'ap' : 'ad';
    const opts = [c, ...c.alt];
    const idx = opts.findIndex(o => (o.traits || []).includes(want) && !(o.traits || []).includes(want === 'ap' ? 'ad' : 'ap'));
    if (idx >= 0 && idx !== state.variant) { state.variant = idx; save(); }
  }
  window.onLiveData = function (d) {
    const info = $('liveInfo');
    if (!state.live) return;
    if (!d || !d.activePlayer) {
      if (game) { game = null; myGold = null; myItemIds = []; renderSituation(); renderBuild(); }
      wasLive = false; info.textContent = ''; return;
    }
    try {
      const me = d.activePlayer;
      const myName = me.riotId || me.summonerName;
      const p = (d.allPlayers || []).find(x => (x.riotId || x.summonerName) === myName);
      const raw = p && p.rawChampionName ? p.rawChampionName.split('_').pop().toLowerCase() : '';
      const c = CHAMPS.find(x => x.id.toLowerCase() === raw) || (p && CHAMPS.find(x => x.name === p.championName));
      const time = (d.gameData || {}).gameTime || 0;
      if (c) {
        if (!wasLive && time < 150 && state.owned.length && c.id !== state.champ) {
          newGame();   // 새 게임이 시작됨
        }
        if (c.id !== state.champ) setChamp(c.id);
      }
      // 조합·레벨
      const toId = x => {
        const r = x.rawChampionName ? x.rawChampionName.split('_').pop().toLowerCase() : '';
        const cc = CHAMPS.find(y => y.id.toLowerCase() === r) || CHAMPS.find(y => y.name === x.championName);
        return cc ? cc.id : null;
      };
      const myTeam = p ? p.team : null;
      const foes = (d.allPlayers || []).filter(x => x.team !== myTeam).map(x => ({
        id: toId(x), level: x.level || 0,
        k: (x.scores || {}).kills || 0, d: (x.scores || {}).deaths || 0, a: (x.scores || {}).assists || 0,
        items: (x.items || []).map(it => String(it.itemID)),
      })).filter(x => x.id);
      const ng = {
        level: me.level || 0, time, foes,
        allies: (d.allPlayers || []).filter(x => x.team === myTeam).map(toId).filter(Boolean),
        enemies: (d.allPlayers || []).filter(x => x.team !== myTeam).map(toId).filter(Boolean),
      };
      const sig = g => g.foes.map(f => f.items.join('.') + ':' + f.k + '/' + f.d).join('|');
      const changed = !game || game.level !== ng.level || game.enemies.join() !== ng.enemies.join() || game.allies.join() !== ng.allies.join() || sig(game) !== sig(ng);
      game = ng;
      if (changed) { renderSituation(); renderBuild(); }
      // 내 아이템
      const g = Math.floor(me.currentGold || 0);
      const ids = ((p && p.items) || []).map(it => String(it.itemID));
      const goldChanged = myGold == null || Math.abs(g - myGold) >= 25 || ids.join() !== myItemIds.join();
      myGold = g; myItemIds = ids;
      const before = [...myItems].join();
      myItems = new Set(((p && p.items) || []).map(it => (ITEM_BY_ID[String(it.itemID)] || itemInfo(it.displayName) || {}).icon).filter(Boolean));
      if ([...myItems].join() !== before) { autoVariant(); renderAll(); }
      else if (goldChanged) renderBuild();
      info.textContent = `게임 연결됨 · ${me.level || '?'}레벨`;
      wasLive = true;
    } catch (e) { /* 형식이 달라도 수동 입력으로 계속 쓸 수 있다 */ }
  };

  // ---------- 아이패드·휴대폰에서 열기 ----------
  if (NATIVE) {
    HELPER = true;
    window.onShareInfo = function (on, url) {
      const info = $('shareInfo');
      info.hidden = !on;
      info.textContent = on ? (url ? `같은 와이파이에 연결된 기기의 사파리에서 ${url} 을 여세요. 이 앱이 켜져 있는 동안만 열립니다.` : '네트워크 주소를 찾지 못했습니다. 와이파이 연결을 확인하세요.') : '';
    };
    window.onScanInfo = function (on, allowed) {
      scanStatus = !on ? '증강 자동 인식 꺼짐' : !allowed ? '⚠ 화면 기록 권한 필요 (⚙ 참고)' : '증강 자동 인식 켜짐';
      renderSituation();
      const info = $('scanInfo');
      info.hidden = !on;
      info.textContent = !on ? '' : allowed
        ? '켜짐. 증강을 고를 차례가 되면 화면에서 증강 이름을 읽어 자동으로 채웁니다.'
        : '맥의 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 기록에서 「증바람 도우미」를 허용한 뒤, 앱을 껐다 켜 주세요.';
    };
    const applyScan = () => { try { window.webkit.messageHandlers.native.postMessage({ type: 'scan', value: !!state.autoScan }); } catch (e) { /* 무시 */ } };
    $('scanToggle').checked = !!state.autoScan;
    $('scanToggle').addEventListener('change', e => { state.autoScan = e.target.checked; applyScan(); save(); });
    applyScan();
    const applyShare = () => { try { window.webkit.messageHandlers.native.postMessage({ type: 'share', value: !!state.share }); } catch (e) { /* 무시 */ } };
    $('shareToggle').checked = !!state.share;
    $('shareToggle').addEventListener('change', e => { state.share = e.target.checked; applyShare(); save(); });
    applyShare();
  } else {
    // 브라우저(아이패드 등)에서 열렸을 때: 맥 앱 전용 설정은 숨기고, 챔피언 정보는 맥 앱에서 받아 온다.
    document.querySelectorAll('.native-only').forEach(n => { n.hidden = true; });
    const startHelperPolling = () => {
      HELPER = true;
      setInterval(() => {
        if (!state.live) return;
        fetch('/live', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => window.onLiveData(d)).catch(() => {});
      }, 1000);
      setInterval(() => {
        if (game) return;
        fetch('/select', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (JSON.stringify(d) !== JSON.stringify(selectData)) window.onChampSelect(d); }).catch(() => {});
      }, 1500);
      const pollStatus = () => fetch('/status', { cache: 'no-store' }).then(r => r.json()).then(st => {
        // 윈도우 도우미는 상태 문구(msg)를 직접 보내 준다
        scanStatus = st.msg ? st.msg : !st.scan ? '증강 자동 인식 꺼짐 (맥 창 ⚙에서 켜기)' : !st.allowed ? '⚠ 맥에서 화면 기록 권한을 허용해야 증강이 자동으로 읽힙니다' : '증강 자동 인식 켜짐';
        renderSituation();
      }).catch(() => {});
      pollStatus(); setInterval(pollStatus, 5000);
    };
    // 같은 주소에 도우미(맥 앱·윈도우 도우미)가 있는지 한 번 확인한다
    if (location.protocol.startsWith('http')) {
      fetch('/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
        .then(st => { if (st && typeof st.scan === 'boolean') startHelperPolling(); else manualMode(); })
        .catch(manualMode);
    } else setTimeout(manualMode, 0);      // 아래쪽 준비가 끝난 뒤에 실행
  }
  // 도우미 없이 연 경우: 자동 인식이 없으니 직접 누르는 방식으로 안내한다
  function manualMode() {
    HELPER = false;
    document.querySelectorAll('.helper-only').forEach(n => { n.hidden = true; });
    renderAll();
  }

  // ---------- 픽창 추천: 내 챔피언과 대기석 중 무엇이 좋은지 ----------
  const CH_BY_KEY = {};
  CHAMPS.forEach(c => { if (c.key != null) CH_BY_KEY[c.key] = c; });
  const TIER_PT = { S: 90, A: 78, B: 64, C: 50, D: 35 };
  let selectData = null;
  function scoreCandidate(id, allies) {
    const reasons = [];
    const ct = (E.K.champTiers || {})[id];
    let s = ct ? TIER_PT[ct.tier] : 60;
    if (ct) reasons.push({ t: s >= 70 ? 'good' : s < 55 ? 'bad' : 'info', text: `두리T ${E.CLASS_KO[ct.class] || ''} 챔피언 티어 ${ct.tier}` + (ct.note ? ` — ${ct.note}` : ''), video: ct.video });
    else reasons.push({ t: 'info', text: '두리T 티어표에 없는 챔피언' });
    const t = traitsOf(id);
    const cnt = f => allies.filter(a => f(traitsOf(a))).length;
    const isTank = x => x.has('tank') || x.has('tankbuild');
    if (allies.length >= 2) {
      const tanks = cnt(isTank), cc = cnt(x => x.has('cc')), ap = cnt(x => x.has('ap') && !x.has('ad')), ad = cnt(x => x.has('ad') && !x.has('ap'));
      const adc = cnt(x => x.has('marksman')), ench = cnt(x => x.has('enchanter'));
      if (tanks === 0 && isTank(t)) { s += 12; reasons.push({ t: 'good', text: '우리 팀에 탱커가 없음 → 앞에 설 챔피언' }); }
      else if (tanks === 0 && t.has('bruiser')) { s += 5; reasons.push({ t: 'good', text: '탱커가 없어 브루저라도 앞줄이 됨' }); }
      if (tanks >= 2 && isTank(t)) { s -= 6; reasons.push({ t: 'bad', text: '탱커가 이미 충분함' }); }
      if (cc <= 1 && t.has('cc')) { s += 6; reasons.push({ t: 'good', text: '우리 팀 군중 제어 부족 → CC 보탬' }); }
      if (ap === 0 && t.has('ap') && !t.has('ad')) { s += 7; reasons.push({ t: 'good', text: '우리 팀이 물리 피해뿐 → 마법 피해 보탬' }); }
      if (ad === 0 && t.has('ad') && !t.has('ap')) { s += 7; reasons.push({ t: 'good', text: '우리 팀이 마법 피해뿐 → 물리 피해 보탬' }); }
      if (adc === 0 && t.has('marksman')) { s += 5; reasons.push({ t: 'good', text: '지속 딜러(원딜)가 없음' }); }
      if (adc >= 2 && t.has('marksman')) { s -= 5; reasons.push({ t: 'bad', text: '원딜이 이미 둘 이상' }); }
      if (ench === 0 && t.has('enchanter') && tanks + adc >= 2) { s += 4; reasons.push({ t: 'good', text: '지켜 줄 아군이 있어 서폿 가치가 높음' }); }
      if (ench >= 1 && t.has('enchanter')) { s -= 5; reasons.push({ t: 'bad', text: '유틸 서폿이 이미 있음' }); }
    }
    // 이 챔피언으로 노릴 증강 (강의에서 이 챔피언을 콕 집은 증강)
    const aims = AUGS.filter(a => ((E.K.augs[a.id] || {}).goodChamps || []).some(g => g.id === id)).map(a => a.name).slice(0, 4);
    return { id, score: Math.max(1, Math.min(99, Math.round(s))), reasons, aims };
  }
  window.onChampSelect = function (d) {
    if (!state.live) d = null;
    selectData = d && d.team ? d : null;
    if (selectData) {
      const mine = selectData.team.find(x => x.cell === selectData.me);
      const c = mine && CH_BY_KEY[mine.champ];
      if (c && c.id !== state.champ) { newGame(); state.champ = c.id; state.variant = 0; save(); }
      else if (c && (state.owned.length || state.seen.length) && !game) { newGame(); save(); }   // 새 판 준비
    }
    renderAll();
  };
  function renderSelect() {
    const box = $('select');
    box.innerHTML = '';
    $('selectBlock').hidden = !selectData;
    if (!selectData) return;
    const mine = selectData.team.find(x => x.cell === selectData.me);
    const myId = mine && CH_BY_KEY[mine.champ] ? CH_BY_KEY[mine.champ].id : null;
    const allies = selectData.team.filter(x => x.cell !== selectData.me).map(x => CH_BY_KEY[x.champ]).filter(Boolean).map(c => c.id);
    const cands = [...new Set([myId, ...selectData.bench.map(k => (CH_BY_KEY[k] || {}).id)].filter(Boolean))];
    $('selectHead').textContent = `우리 팀 ${allies.length + (myId ? 1 : 0)}명 · 대기석 ${selectData.bench.length}명`;
    if (!cands.length) { box.appendChild(el('div', 'empty', '챔피언이 정해지면 추천이 나옵니다.')); return; }
    const ranked = cands.map(id => scoreCandidate(id, allies)).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const v = el('div', 'verdict ' + (best.id === myId ? 'take' : 'reroll'));
    v.appendChild(el('b', null, best.id === myId ? `지금 챔피언(${CH[myId].name}) 그대로가 가장 좋습니다` : `대기석의 ${CH[best.id].name}(으)로 바꾸는 걸 추천`));
    if (best.id !== myId && myId) {
      const me = ranked.find(x => x.id === myId);
      if (me) v.appendChild(el('span', null, `${CH[myId].name} ${me.score}점 → ${CH[best.id].name} ${best.score}점`));
    }
    box.appendChild(v);
    ranked.slice(0, 6).forEach((r, i) => {
      const c = CH[r.id];
      const card = el('div', 'card ' + (r.score >= 85 ? 'g5' : r.score >= 70 ? 'g4' : r.score >= 55 ? 'g3' : 'g2') + (i === 0 ? ' best' : ''));
      const head = el('div', 'card-head');
      const ic = img(c.icon, 'aug-icon'); ic.style.borderRadius = '50%';
      head.appendChild(ic);
      const title = el('div', 'card-title');
      title.appendChild(el('div', 'name', c.name + (r.id === myId ? ' (지금 내 챔피언)' : ' (대기석)')));
      if (r.aims.length) title.appendChild(el('div', 'sub', '노릴 증강: ' + r.aims.join(', ')));
      head.appendChild(title);
      const sc = el('div', 'score'); sc.appendChild(el('b', null, String(r.score))); head.appendChild(sc);
      card.appendChild(head);
      const body = el('div', 'card-body');
      r.reasons.slice(0, i === 0 ? 5 : 3).forEach(x => {
        const li = el('div', 'reason ' + x.t);
        li.appendChild(el('span', null, (x.t === 'good' ? '＋ ' : x.t === 'bad' ? '－ ' : '· ') + x.text));
        const vl = videoLink(x.video); if (vl) li.appendChild(vl);
        body.appendChild(li);
      });
      card.appendChild(body);
      box.appendChild(card);
    });
    // 우리 팀 구성 한 줄
    if (allies.length) box.appendChild(el('div', 'sub', '우리 팀: ' + allies.map(a => CH[a].name).join(', ')));
  }

  // ---------- 증강 화면 자동 인식 ----------
  // 맥 앱이 화면에서 읽은 글자 목록을 받아, 증강 이름을 찾아 선택지를 채운다.
  const NAME_IDX = AUGS.map(a => ({ id: a.id, n: a.name.replace(/[\s!?,.'’:·\-]/g, '') })).sort((x, y) => y.n.length - x.n.length);
  function lev1(a, b) {          // 글자 하나 차이(오인식)까지 같은 이름으로 본다
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++d > 1) return false;
      if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
    }
    return true;
  }
  function matchAug(text) {
    const t = text.replace(/[\s!?,.'’:·\-]/g, '');
    if (!t || t.length > 16) return null;       // 긴 문장(설명문)은 카드 제목이 아니다
    for (const a of NAME_IDX) {
      if (t === a.n) return a.id;
      if (a.n.length >= 4 && lev1(t, a.n)) return a.id;
    }
    return null;
  }
  // 카드 제목은 가로로 한 줄에 나란히 놓인다 → 같은 높이에 증강 이름이 2~3개 있으면 선택 화면
  function findRow(items) {
    const hits = [];
    (items || []).forEach(it => { const id = matchAug(it.t || ''); if (id) hits.push({ id, x: it.x, y: it.y }); });
    let best = [];
    hits.forEach(h => {
      const row = hits.filter(o => Math.abs(o.y - h.y) < 0.04);
      const uniq = [...new Map(row.map(o => [o.id, o])).values()].sort((a, b) => a.x - b.x);
      const spread = uniq.length > 1 ? uniq[uniq.length - 1].x - uniq[0].x : 0;
      if (uniq.length >= 2 && uniq.length <= MAX_OFFER && spread > 0.15 && uniq.length > best.length) best = uniq;
    });
    best = best.filter(o => !state.owned.includes(o.id));
    // 카드 줄과 다른 높이에 같은 증강 이름이 또 보이면, 그 카드에 마우스가 올라가 있는 것
    const rowY = best.length ? best[0].y : 0;
    const hov = hits.find(h => best.some(o => o.id === h.id) && Math.abs(h.y - rowY) > 0.1);
    return { ids: best.map(o => o.id), hover: hov ? hov.id : null };
  }
  let lastRow = '', sameCount = 0, emptyCount = 0, autoOffered = false, awaitPick = false;
  let lastHover = null, lastAuto = null;
  window.onScreenText = function (d) {
    if (!state.autoScan || !d || !d.items) return;
    detectHeadliner(d.items);
    const found = findRow(d.items);
    const row = found.ids;
    const key = row.join();
    if (row.length >= 2) {
      emptyCount = 0;
      lastHover = found.hover;          // 선택 화면이 사라지기 직전 값이 곧 뽑은 카드
      sameCount = key === lastRow ? sameCount + 1 : 1;
      lastRow = key;
      if (sameCount < 2 || key === state.offered.join()) return;      // 두 번 연속 같게 읽혀야 반영
      // 카드 한 장만 바뀌었으면 새로고침한 것
      const gone = state.offered.filter(id => !row.includes(id));
      if (autoOffered && state.offered.length >= 3 && row.length === state.offered.length && gone.length === 1) {
        if (!state.seen.includes(gone[0])) state.seen.push(gone[0]);
        row.filter(id => !state.offered.includes(id)).forEach(id => { if (!state.fresh.includes(id)) state.fresh.push(id); });
      } else if (!autoOffered || gone.length > 1) {
        state.fresh = []; pendingFresh = 0;
      }
      state.offered = row.slice(0, MAX_OFFER);
      autoOffered = true; awaitPick = false; state.open = {};
      save(); renderAll();
    } else if (autoOffered && state.offered.length && ++emptyCount >= 2 && !awaitPick) {
      // 선택 화면이 사라짐 → 마지막에 마우스가 올라가 있던 카드를 뽑은 것으로 넣는다
      if (lastHover && state.offered.includes(lastHover)) {
        lastAuto = { id: lastHover, others: state.offered.filter(o => o !== lastHover) };
        takeAugment(lastHover);
      } else {
        awaitPick = true;        // 단서가 없으면 한 번만 물어본다
        renderAll();
      }
    }
  };
  // 증강을 고를 차례인 동안에만 화면 읽기를 요청한다 (게임 성능 보호)
  // 게임에 연결돼 있는 동안 계속 읽는다. (증강이 뜨는 레벨이 패치마다 달라 레벨로 거르지 않는다)
  function pickPending() {
    return !!(state.autoScan && game && HELPER !== false);
  }
  setInterval(() => {
    if (!pickPending()) return;
    if (NATIVE) { try { window.webkit.messageHandlers.native.postMessage({ type: 'scanWant' }); } catch (e) { /* 무시 */ } }
    else if (location.protocol.startsWith('http')) {
      fetch('/screen', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => window.onScreenText(d)).catch(() => {});
    }
  }, 1000);

  const m = window.DATA_META || {};
  const km = (E.K.meta || {});
  $('metaLine').textContent = `증강 ${AUGS.length}개 · 게임 데이터 ${String(m.gameVersion || '').split('+')[0]}` + (km.videoCount ? ` · 두두두리T 강의 ${km.videoCount}편 반영` : '');
  renderAll();
})();
