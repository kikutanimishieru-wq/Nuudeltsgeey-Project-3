export const mongolianRanks = [
  { tier: 1, name: 'Шинэ дайчин', englishName: 'Recruit', minimumNr: 0 },
  { tier: 2, name: 'Дайчин', englishName: 'Warrior', minimumNr: 1 },
  { tier: 3, name: 'Аравтын ахлагч', englishName: 'Arban Leader', minimumNr: 10 },
  { tier: 4, name: 'Зуутын ноён', englishName: 'Jagun Commander', minimumNr: 100 },
  { tier: 5, name: 'Мянгатын ноён', englishName: 'Mingghan Commander', minimumNr: 1_000 },
  { tier: 6, name: 'Түмтийн ноён', englishName: 'Tümen Commander', minimumNr: 10_000 },
  { tier: 7, name: 'Хишигтэн', englishName: 'Imperial Guard', minimumNr: 15_000 },
  { tier: 8, name: 'Их жанжин', englishName: 'Great General', minimumNr: 20_000 },
  { tier: 9, name: 'Их хаан', englishName: 'Great Khan', minimumNr: 30_000 },
] as const;

export function getRankForNr(nr: number) {
  return mongolianRanks.reduce((current, rank) => nr >= rank.minimumNr ? rank : current, mongolianRanks[0]);
}
