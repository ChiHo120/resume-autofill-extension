// 未识别是页面问题，资料缺失是简历问题；禁止把前者同步成待补充个人信息。
export const isFillable = field => !!field && !field.protected && field.kind === 'text' && field.recognition?.status !== 'unrecognized';
