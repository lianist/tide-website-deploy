# 인증 메일 템플릿 — 사본

운영 중인 인증 메일의 **원본은 Supabase 대시보드**다(프로젝트 `dochi` → Authentication → Emails).
이 폴더는 그 **사본**이다 — 대시보드를 고치면 여기도 **손으로** 맞춘다.

| 파일 | 대시보드 항목 | 링크 |
|---|---|---|
| `confirmation.html` | Confirm signup | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/dashboard` |
| `recovery.html` | Reset password | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password/update` |

두 HTML 파일은 대시보드에 반영된 본문을 그대로 옮긴 것이다(2026-09-26 사용자 반영분 — 스팸함 대책으로 Supabase 기본 영어 문구를 한국어 자체 문구로 바꿨다. 기본 문구는 수많은 프로젝트와 피싱이 같은 모양이라 필터가 의심한다). 메일 **제목**과 **보낸 사람 이름**(SMTP 설정)은 HTML 밖에 있으므로 아래에 함께 적어 둔다.

- 보낸 사람 이름: `Tide`
- Confirm signup 제목: `[Tide] 이메일 주소를 확인해 주세요`
- Reset password 제목: `[Tide] 비밀번호 재설정 링크입니다`

## 지킬 것

- **보이는 이름은 Tide다**(`docs/00-Product.md` 결정 기록 10). 제목·본문·보낸 사람 이름 어디에도 `Dochi`를 쓰지 않는다.
- **링크는 `token_hash` 형식을 유지한다**(`docs/03-Architecture.md` §설계 결정 12). `{{ .ConfirmationURL }}`로 되돌리면 컴퓨터에서 가입하고 폰에서 메일을 열 때 깨진다. `type`은 `app/auth/callback/route.ts`가 받는 값이어야 하고, `next`는 같은 사이트 경로여야 한다(`lib/auth/next.ts`).
- 🔴 **`supabase config push`로 반영하지 않는다.** dry-run이 없고, `supabase/config.toml`의 로컬 전용 값(`site_url = "http://127.0.0.1:3000"`, 주석 처리된 SMTP)까지 운영에 밀어 Resend SMTP와 이 템플릿을 덮을 수 있다(`docs/03-Architecture.md` §설계 결정 22). 그래서 `config.toml`의 `[auth.email.template.*]`도 이 폴더를 가리키지 않는다.
