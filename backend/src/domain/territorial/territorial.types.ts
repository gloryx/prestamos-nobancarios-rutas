export type Province = { code: number; name: string };

export type Canton = { code: number; name: string; province: Province };

export type District = {
  code: number;
  name: string;
  canton: { code: number; name: string };
  province: Province;
};
