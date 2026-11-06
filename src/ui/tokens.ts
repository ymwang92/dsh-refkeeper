/** Shared visual tokens for the capture panel. */
export const UI_TOKENS = {
  spacing: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },
  radius: {
    control: '6px',
    panel: '10px',
  },
  fontSize: {
    caption: '11px',
    control: '12px',
  },
  color: {
    success: 'var(--dsw-alias-state-success-primary, #1a7f37)',
    warning: 'var(--dsw-alias-state-warn-primary, #b26a00)',
    error: 'var(--dsw-alias-state-error-primary, #b42318)',
    neutral: 'var(--dsw-alias-label-secondary, #6b7280)',
  },
} as const
