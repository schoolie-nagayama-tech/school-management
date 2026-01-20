// ランダムパスワードを生成（8文字、英大文字・小文字・数字を含む）
export function generatePassword(length: number = 8): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I, O を除外（見間違い防止）
  const lowercase = 'abcdefghjkmnpqrstuvwxyz'; // i, l, o を除外
  const numbers = '23456789'; // 0, 1 を除外
  
  const allChars = uppercase + lowercase + numbers;
  
  let password = '';
  
  // 各種類から最低1文字ずつ
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  
  // 残りをランダムに
  for (let i = 3; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // シャッフル
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}
