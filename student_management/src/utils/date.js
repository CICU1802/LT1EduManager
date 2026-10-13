export function vietnamDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const part = (type) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function currentAcademicYear() {
  const date = vietnamDate();
  const y = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 8 ? 1 : 0);
  return `${y}-${y + 1}`;
}
