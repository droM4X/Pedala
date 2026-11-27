PedalaI18n.add({
  code: "zz", name: "Testish", locale: "en-GB",
  strings: new Proxy({}, { get: (_, k) => typeof k === "string" ? "zz:" + k : undefined }),
  speech: {
    watts: n => `zz:${n} watts`, duration: s => `zz:${s} sec`,
    cadence: (a, b) => `zz:${a}-${b}`, segment: (s, ctx) => `zz:${ctx.duration(s.d)}`,
    lap: () => "zz:lap", finish: () => "zz:finish", strength: () => "zz:strength",
    start: () => "zz:start", soon: s => `zz:soon ${s}`
  }
});
