export default {
  '*.{ts,tsx,js,jsx,json,md,css}': ['prettier --write'],
  '*.{ts,tsx,js,jsx}': ['eslint --fix --max-warnings 0 --no-warn-ignored'],
};
