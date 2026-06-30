# PRO Upgrade Dialog Redesign

## Context
LetShare P2P file sharing app. Settings page needs a beautiful upgrade dialog for PRO membership.

## Target Component
`d:\myfiles\LetShare\src\components\Settings.tsx` — the `<Dialog>` at lines 421-484.

## Existing Code (current ugly version)
```tsx
<Dialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} maxWidth="xs" fullWidth>
  <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
    <Typography variant="h6" fontWeight={700} textAlign="center">升级 LetShare PRO</Typography>

    {/* Free card */}
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, opacity: 0.7 }}>
      ...Free content...
    </Box>

    {/* PRO card */}
    <Box sx={{ border: '2px solid', borderColor: 'primary.main', borderRadius: 2, p: 2, bgcolor: 'rgba(25,118,210,0.04)' }}>
      ...PRO content...
    </Box>

    {/* Email + copy */}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
      ...
    </Box>

    {/* Activation code */}
    <Box sx={{ display: 'flex', gap: 1 }}>
      <TextField ... />
      <Button ...>激活</Button>
    </Box>
  </Box>
</Dialog>
```

## Requirements
1. MUI 5 sx props only — NO external CSS files
2. Match LetShare design language (rounded, clean, modern)
3. Two pricing tiers: Free (muted) vs PRO (highlighted, ¥19.9/年)
4. Email `a454888395@gmail.com` with copy-to-clipboard icon
5. Activation code input at bottom with activate button
6. Dialog maxWidth="xs", fullWidth
7. Keep existing state variables: `upgradeOpen`, `inviteCode`, `inviteError`, `copied`
8. Keep existing handlers: `handleActivatePro`, `handleCopyEmail`, `setUpgradeOpen`
9. TypeScript strict, must compile with `npx tsc --noEmit`

## Design Direction
Editorial/clean. Not corporate SaaS. Think: indie app, thoughtful details, gentle gradients or subtle backgrounds. PRO card should feel premium but not gaudy. Free card should feel intentional but clearly secondary.
