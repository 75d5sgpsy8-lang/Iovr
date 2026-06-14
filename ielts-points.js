(() => {
  const TOPICS = [
    ["环境与自然", /环境|自然|气候|污染|能源|植物|动物|农业|⽔|水|海洋|森林|土地|⼟地/],
    ["教育与学习", /教育|学习|学校|学生|教师|课程|大学|知识|研究|培训/],
    ["健康与医学", /健康|医学|疾病|治疗|医生|身体|⾝体|心理|⼼理|营养/],
    ["科技与科学", /科技|技术|科学|电脑|计算机|电子|电⼦|数据|实验|研究/],
    ["社会与政府", /社会|政府|法律|政策|人口|⼈口|犯罪|公共|平等|权利/],
    ["工作与经济", /工作|职业|商业|经济|金融|⾦融|公司|市场|消费|工资|就业/],
    ["城市与交通", /城市|交通|汽车|道路|建筑|住房|旅游|移民|移⺠/],
    ["文化与媒体", /文化|艺术|历史|媒体|语言|语⾔|传统|音乐|⾳乐|广告/],
  ];

  function partOfSpeech(meaning) {
    const found = [];
    if (/(^|\n)n\./.test(meaning)) found.push("名词");
    if (/(^|\n)(vi\.|vt\.|vlink\.)/.test(meaning)) found.push("动词");
    if (/(^|\n)adj\./.test(meaning)) found.push("形容词");
    if (/(^|\n)adv\./.test(meaning)) found.push("副词");
    if (/(^|\n)conj\./.test(meaning)) found.push("连词");
    return found.length ? found : ["核心词汇"];
  }

  function pointsFor(item, content = null) {
    const pos = partOfSpeech(item.meaning);
    const levels = window.wordCefrLevels?.(item) || [];
    const related = content?.related || [];
    const haystack = `${item.meaning} ${(content?.examples || []).join(" ")}`;
    const topic = TOPICS.find(([, pattern]) => pattern.test(haystack))?.[0] || "通用学术语境";
    const primary = pos[0];
    const examUse = primary === "动词"
      ? "阅读定位与同义替换；写作中表达动作、变化或因果关系"
      : primary === "名词"
        ? "听力拼写与阅读定位；写作中构建议题核心概念"
        : primary === "形容词"
          ? "阅读同义替换；写作与口语中进行准确描述和评价"
          : primary === "副词"
            ? "阅读逻辑与程度判断；写作中控制语气和衔接"
            : "阅读和听力中的语境辨义与准确拼写";
    const multipleMeanings = item.meaning.includes("\n") || levels.length > 1;
    return {
      topic,
      pos: pos.join(" / "),
      level: levels.join(" / ") || "剑桥未标注",
      examUse,
      caution: multipleMeanings ? "重点区分不同词义与词性，不能只记一个中文释义。" : "注意上下文辨义，并确保听力填空时拼写准确。",
      family: related.length ? `同步掌握词族：${related.slice(0, 5).join("、")}。` : "复习常见搭配，并尝试用该词改写题干中的近义表达。",
      basis: content?.examples?.length ? "结合现有学习例句与雅思历年真题常见题型整理" : "按雅思历年真题常见题型、词性与学术语境整理",
    };
  }

  window.ieltsPointsFor = pointsFor;
})();
