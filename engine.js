// 추천 엔진: 챔피언 특성 + 이미 가진 증강 + 두두두리T 강의 지식으로 점수를 매긴다.
(function () {
  const K = window.KNOWLEDGE || { champs: {}, augs: {}, general: [], videos: {} };
  const AUG = {};
  (window.AUGMENTS || []).forEach(a => { AUG[a.id] = a; });

  const TRAIT_KO = {
    ap: '주문력', ad: '공격력', tankbuild: '탱 빌드', melee: '근접', ranged: '원거리',
    marksman: '원딜', mage: '메이지', tank: '탱커', bruiser: '브루저', assassin: '암살자', enchanter: '유틸 서폿',
    crit: '치명타', onhit: '적중 시 효과', attackspeed: '공격 속도', autoattack: '기본 공격 위주',
    spellspam: '스킬 난사', haste: '스킬 가속', burst: '폭딜', dot: '지속 피해', poke: '견제', aoe: '광역',
    cc: '군중 제어', slow: '둔화', heal_self: '자체 회복', heal_ally: '아군 회복·보호막', shield: '보호막',
    dash: '돌진기', mobile: '이동 속도', summon: '소환수', stacking: '성장 스택', mana: '마나', manaless: '무마나',
    ult: '궁극기', hp_scaling: '체력 계수', stealth: '은신', revive: '부활', summoner_spell: '소환사 주문', gold: '골드',
  };
  const CLASS_KO = { marksman: '원딜', mage: '메이지', tank: '탱커', bruiser: '브루저', assassin: '암살자', enchanter: '유틸 서폿', all: '공통' };
  const TIER_SCORE = { S: 92, A: 78, B: 63, C: 47, D: 28 };
  const COMM_SCORE = { S: 88, A: 76, B: 62, C: 48, D: 32 };
  const FLAG_TXT = { enemy_tanks: '적 탱커 많음', enemy_squishy: '적 물몸 위주', enemy_healers: '적 회복 많음', enemy_shields: '적 보호막 많음', enemy_ap: '적 마법 피해 위주', enemy_ad: '적 물리 피해 위주', enemy_cc: '적 군중 제어 많음', enemy_poke: '적 견제 조합', enemy_dive: '적 돌진·암살 많음', ally_no_tank: '우리 팀 탱커 없음', ally_healers: '우리 팀 회복 있음' };
  // 챔피언이 원래 갖고 있어야 의미가 있는 것(증강이 줘도 대체 안 되는 것)
  const INNATE = new Set(['melee', 'ranged', 'marksman', 'mage', 'tank', 'bruiser', 'assassin', 'enchanter', 'summon', 'mana', 'manaless', 'stealth', 'heal_ally']);

  function profile(champId, variant) {
    const c = K.champs[champId];
    if (!c) return { classes: [], traits: new Set(), known: false };
    const src = (variant > 0 && c.alt && c.alt[variant - 1]) ? c.alt[variant - 1] : c;
    return { classes: src.class || [], traits: new Set([...(src.traits || []), ...(src.class || [])]), known: true };
  }

  function variantsOf(champId) {
    const c = K.champs[champId];
    if (!c || !c.alt || !c.alt.length) return [];
    const mainLabel = (c.class || []).map(x => CLASS_KO[x] || x).join('·') || '기본';
    return [mainLabel, ...c.alt.map(a => a.label)];
  }

  // 부류별 평가와 전체 평가가 둘 다 있으면 섞되, 더 최신 영상 쪽에 무게를 둔다.
  function tierFor(k, classes) {
    const t = k.tier || {};
    let own = null;
    for (const cl of classes) if (t[cl]) { own = { ...t[cl], cls: cl }; break; }
    const all = t.all ? { ...t.all, cls: 'all' } : null;
    if (!own && !all) return null;
    const list = [own, all].filter(Boolean).filter(x => TIER_SCORE[x.tier] != null);
    if (!list.length) return null;
    if (list.length === 1) return { parts: list, score: TIER_SCORE[list[0].tier] };
    const ownNewer = (own.rank == null ? 1e6 : own.rank) <= (all.rank == null ? 1e6 : all.rank);
    const wOwn = ownNewer ? 0.75 : 0.45;
    return { parts: list, score: wOwn * TIER_SCORE[own.tier] + (1 - wOwn) * TIER_SCORE[all.tier] };
  }

  function findLink(list, id) {
    return (list || []).find(x => x.id === id);
  }

  // ctx(선택): { flags: 상황 태그 배열, round: 이번이 몇 번째 선택인지(0부터) }
  function score(augId, champId, variant, ownedIds, ctx) {
    const a = AUG[augId];
    const k = K.augs[augId] || {};
    const p = profile(champId, variant);
    const reasons = [];   // {t: 'good'|'bad'|'info', text}
    let s;

    // 1) 기본 점수: 강의 티어 > 일반적 강함
    const tf = tierFor(k, p.known ? p.classes : []);
    if (tf) {
      s = tf.score;
      tf.parts.forEach(x => {
        const v = TIER_SCORE[x.tier];
        reasons.push({ t: v >= 70 ? 'good' : v < 50 ? 'bad' : 'info', text: `두리T ${CLASS_KO[x.cls]} 티어 ${x.tier}` + (x.note ? ` — ${x.note}` : ''), video: x.video });
      });
    } else {
      s = 40 + (k.power || 3) * 7;
    }
    // 다른 공략·커뮤니티의 평가(두 번째 의견): 강의 평가가 있으면 25%만 섞고, 없으면 기본 점수로 쓴다
    const cm = k.community;
    if (cm && COMM_SCORE[cm.tier] != null) {
      const cv = COMM_SCORE[cm.tier];
      s = tf ? 0.75 * s + 0.25 * cv : cv;
      reasons.push({ t: cv >= 70 ? 'good' : cv < 50 ? 'bad' : 'info', text: `공략·커뮤니티 평가 ${cm.tier}` + (cm.note ? ` — ${cm.note}` : '') });
    }
    const hasTier = !!tf || !!cm;
    if (p.known && (k.commRoles || []).includes(p.classes[0])) {
      s += 5;
      reasons.push({ t: 'good', text: `공략에서 ${CLASS_KO[p.classes[0]]}에게 추천하는 증강` });
    }

    // op.gg 가 이 챔피언에 추천하는 증강 (많이 쓰이는 순서. 승률 수치는 쓰지 않는다)
    const og = ((K.champs[champId] || {}).opgg || {}).augs || [];
    const oi = og.indexOf(augId);
    if (oi >= 0) {
      s += Math.max(3, 9 - oi * 0.6);
      reasons.push({ t: 'good', text: `op.gg 추천 증강 ${oi + 1}번째 (이 챔피언 기준)` });
    }

    // 2) 강의에서 콕 집은 챔피언
    const gc = findLink(k.goodChamps, champId);
    const bc = findLink(k.badChamps, champId);
    if (gc) { s += 16; reasons.push({ t: 'good', text: '두리T 추천 챔피언' + (gc.note ? ` — ${gc.note}` : ''), video: gc.video }); }
    if (bc) { s -= 22; reasons.push({ t: 'bad', text: '두리T 비추천 챔피언' + (bc.note ? ` — ${bc.note}` : ''), video: bc.video }); }

    // 3) 특성 궁합
    if (p.known) {
      const ownedGives = new Set();
      ownedIds.forEach(o => ((K.augs[o] || {}).gives || []).forEach(g => ownedGives.add(g)));
      if (ctx && ctx.extraGives) ctx.extraGives.forEach(g => ownedGives.add(g));     // 내가 산 아이템이 주는 것
      const has = t => p.traits.has(t);
      const viaAug = t => !INNATE.has(t) && ownedGives.has(t);

      const missing = (k.needs || []).filter(t => !has(t) && !viaAug(t));
      if (missing.length) {
        s -= 34;
        reasons.push({ t: 'bad', text: `조건이 안 맞음: ${missing.map(t => TRAIT_KO[t] || t).join(', ')} 필요` });
      }
      const wants = k.wants || [];
      if (wants.length) {
        const hit = wants.filter(has);
        const hitAug = wants.filter(t => !has(t) && viaAug(t));
        const w = hasTier ? 0.6 : 1;
        if (hit.length) {
          // 맞는 특성이 많을수록, 그리고 증강이 원하는 것을 많이 채울수록 가산
          s += w * Math.min(18, 4.5 * hit.length + 6 * hit.length / wants.length);
          reasons.push({ t: 'good', text: `챔피언과 맞음: ${hit.map(t => TRAIT_KO[t] || t).join(', ')}` });
        } else if (!hitAug.length && !gc) {
          s -= w * 12;
          reasons.push({ t: 'bad', text: `챔피언과 안 맞음 (${wants.slice(0, 3).map(t => TRAIT_KO[t] || t).join(', ')} 챔피언용)` });
        }
        if (hitAug.length) {
          s += 5 * Math.min(2, hitAug.length);
          reasons.push({ t: 'good', text: `가진 증강·아이템이 채워 줌: ${hitAug.map(t => TRAIT_KO[t] || t).join(', ')}` });
        }
      }
      const bad = (k.avoid || []).filter(has);
      if (bad.length && !gc) {
        s -= Math.min(24, 9 * bad.length);
        reasons.push({ t: 'bad', text: `불리한 특성: ${bad.map(t => TRAIT_KO[t] || t).join(', ')}` });
      }
    }

    // 4) 이미 가진 증강과의 조합
    ownedIds.forEach(o => {
      const ko = K.augs[o] || {};
      const on = (AUG[o] || {}).name || o;
      const syn = findLink(k.synergy, o) || findLink(ko.synergy, augId);
      const anti = findLink(k.anti, o) || findLink(ko.anti, augId);
      if (syn) { s += 13; reasons.push({ t: 'good', text: `「${on}」과 시너지` + (syn.note ? ` — ${syn.note}` : ''), video: syn.video }); }
      if (anti) { s -= 15; reasons.push({ t: 'bad', text: `「${on}」과 안 맞음` + (anti.note ? ` — ${anti.note}` : ''), video: anti.video }); }
      if (!syn && !anti) {
        const feed = (k.gives || []).filter(g => !INNATE.has(g) && (ko.wants || []).includes(g));
        if (feed.length) { s += 4; reasons.push({ t: 'good', text: `「${on}」이 원하는 ${feed.map(t => TRAIT_KO[t] || t).join(', ')}을(를) 줌` }); }
      }
    });

    if (s > 86) s = 86 + (s - 86) * 0.35;      // 높은 점수대가 전부 99로 뭉치지 않게 눌러 준다
    // 5) 지금 게임 상황: 적·아군 조합, 그리고 몇 번째 선택인지
    const vs = k.vs;
    if (vs && ctx) {
      const fl = ctx.flags || [];
      const good = (vs.good || []).filter(f => fl.includes(f)), bad = (vs.bad || []).filter(f => fl.includes(f));
      const wt = f => f === 'enemy_poke' ? 4 : 6;      // 견제 조합 신호는 약해서 조금만 반영
      if (good.length) { s += Math.min(12, good.reduce((n, f) => n + wt(f), 0)); reasons.push({ t: 'good', text: `지금 판에 잘 맞음: ${good.map(f => FLAG_TXT[f] || f).join(', ')}` + (vs.why ? ` — ${vs.why}` : '') }); }
      if (bad.length) { s -= Math.min(12, 6 * bad.length); reasons.push({ t: 'bad', text: `지금 판에 불리: ${bad.map(f => FLAG_TXT[f] || f).join(', ')}` }); }
      if (vs.timing === 'early' && ctx.round != null) {
        const adj = [5, 2, -3, -8][Math.min(3, ctx.round)];
        s += adj;
        reasons.push({ t: adj > 0 ? 'good' : 'bad', text: adj > 0 ? '쌓이는 증강이라 일찍 집을수록 이득' : '쌓이는 증강인데 남은 시간이 짧음' });
      }
    }
    // 6) 내 아이템과의 궁합 (앱이 계산해서 넘겨 준다)
    if (ctx && ctx.itemAdjust) {
      const ia = ctx.itemAdjust(a, k);
      if (ia && ia.add) { s += ia.add; ia.reasons.forEach(x => reasons.push(x)); }
    }
    s = Math.max(1, Math.min(99, Math.round(s)));
    const label = s >= 85 ? '강력 추천' : s >= 70 ? '추천' : s >= 55 ? '무난' : s >= 40 ? '애매' : '비추천';
    const grade = s >= 85 ? 'g5' : s >= 70 ? 'g4' : s >= 55 ? 'g3' : s >= 40 ? 'g2' : 'g1';
    return { id: augId, aug: a, k, score: s, label, grade, reasons };
  }

  function rank(ids, champId, variant, ownedIds, ctx) {
    return ids.map(id => score(id, champId, variant, ownedIds, ctx)).sort((x, y) => y.score - x.score);
  }

  // k장을 뽑았을 때 그중 가장 좋은 점수의 기댓값 (같은 증강이 두 번 나오지 않는 뽑기)
  function expectedBest(scores, k) {
    const n = scores.length;
    if (!n) return 0;
    k = Math.min(k, n);
    const sorted = scores.slice().sort((a, b) => b - a);
    let p = k / n, e = 0;                    // p = i번째로 좋은 것이 뽑힌 것 중 최고일 확률
    for (let i = 0; i <= n - k; i++) { e += sorted[i] * p; p = p * (n - k - i) / (n - 1 - i); }
    return e;
  }

  // 앞을 내다보기: 후보를 집었을 때, 남은 선택들에서 기대할 수 있는 "가장 좋은 증강의 점수"가 얼마나 달라지는가.
  //  opt = { excluded: Set(이미 나왔거나 가진 증강), remaining: 남은 선택 횟수, odds: n => {silver,gold,prismatic}, k: 한 선택에서 보게 되는 카드 수, ctx }
  function lookahead(candIds, champId, variant, ownedIds, opt) {
    const out = {};
    const AUGS = window.AUGMENTS || [];
    const round = (opt.ctx && opt.ctx.round) || 0;
    const pools = { silver: [], gold: [], prismatic: [] };
    AUGS.forEach(a => { if (!opt.excluded.has(a.id) && pools[a.rarity]) pools[a.rarity].push(a.id); });
    const nextCtx = { ...(opt.ctx || {}), round: round + 1 };
    const table = owned => {
      const t = {};
      Object.values(pools).forEach(ids => ids.forEach(id => { t[id] = score(id, champId, variant, owned, nextCtx).score; }));
      return t;
    };
    const future = t => {
      let sum = 0;
      for (let i = 1; i <= opt.remaining; i++) {
        const odds = opt.odds(round + i);
        ['silver', 'gold', 'prismatic'].forEach(rar => { if (odds[rar] > 0) sum += odds[rar] * expectedBest(pools[rar].map(id => t[id]), opt.k); });
      }
      return sum;
    };
    const base = table(ownedIds), baseF = future(base);
    candIds.forEach(c => {
      if (opt.remaining <= 0) { out[c] = { delta: 0, partners: [] }; return; }
      const t = table([...ownedIds, c]);
      // 짝 증강: 이 후보를 집으면 점수가 크게 오르는 증강과, 남은 선택에서 그걸 볼 확률
      const partners = [];
      Object.keys(t).forEach(id => {
        const gain = t[id] - base[id];
        if (id === c || gain < 8) return;
        const rar = AUG[id].rarity, n = pools[rar].length;
        let miss = 1;
        for (let i = 1; i <= opt.remaining; i++) miss *= 1 - (opt.odds(round + i)[rar] || 0) * Math.min(1, opt.k / n);
        partners.push({ id, gain, p: 1 - miss });
      });
      partners.sort((a, b) => b.gain * b.p - a.gain * a.p);
      out[c] = { delta: future(t) - baseF, partners: partners.slice(0, 3), anyP: partners.length ? 1 - partners.reduce((m, x) => m * (1 - x.p), 1) : 0 };
    });
    return out;
  }

  // 한글 초성 검색
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function chosung(str) {
    let out = '';
    for (const ch of str) {
      const c = ch.charCodeAt(0) - 0xac00;
      out += (c >= 0 && c <= 11171) ? CHO[Math.floor(c / 588)] : ch;
    }
    return out;
  }
  function norm(s) { return (s || '').toLowerCase().replace(/[\s!?,.'’:·\-]/g, ''); }
  function matches(q, ...fields) {
    q = norm(q);
    if (!q) return true;
    const isCho = [...q].every(ch => CHO.includes(ch));
    return fields.some(f => {
      const n = norm(f);
      return n.includes(q) || (isCho && chosung(n).includes(q));
    });
  }

  window.Engine = { K, AUG, TRAIT_KO, CLASS_KO, profile, variantsOf, score, rank, matches, lookahead, expectedBest };
})();
