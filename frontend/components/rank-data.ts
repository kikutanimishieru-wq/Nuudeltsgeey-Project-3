export const ranks = [
  { tier: 1, name: 'Шинэ дайчин', englishName: 'Recruit', color: '#8d969d', motif: 'dot' },
  { tier: 2, name: 'Дайчин', englishName: 'Warrior', color: '#816649', motif: 'two' },
  { tier: 3, name: 'Аравтын ахлагч', englishName: 'Arban Leader', color: '#72804a', motif: 'nine' },
  { tier: 4, name: 'Зуутын ноён', englishName: 'Jaghun Commander', color: '#9d433e', motif: 'bars' },
  { tier: 5, name: 'Мянгатын ноён', englishName: 'Mingghan Commander', color: '#216999', motif: 'mountain' },
  { tier: 6, name: 'Түмтийн ноён', englishName: 'Tümen Commander', color: '#d3d8d8', motif: 'flame' },
  { tier: 7, name: 'Хишигтэн', englishName: 'Imperial Guard', color: '#c58a31', motif: 'sun' },
  { tier: 8, name: 'Их жанжин', englishName: 'Great General', color: '#972f39', motif: 'star' },
  { tier: 9, name: 'Их хаан', englishName: 'Great Khan', color: '#d5a52c', motif: 'crown' },
] as const;

export type Rank = (typeof ranks)[number];
