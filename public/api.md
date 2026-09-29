# Dochi API

> Dochi 서버 HTTP API의 앱 개발자·LLM용 요약본이다. 이 문서만 읽으면 클라이언트를 붙일 수 있게 썼다.
> 원본 계약은 `lianist/dochi` 저장소의 `docs/04-API-Contract.md`다. 둘이 다르면 원본이 맞고, API가 바뀌면 이 문서도 같은 커밋에서 고친다.
> 최신본은 늘 <https://dochi-six.vercel.app/api.md>에 있다 · 기준일 2026-09-25 (캡처 중복 감지 `duplicates`·`DUPLICATE_TASK`)

## 링크

| | 주소 |
|---|---|
| 서비스(웹 대시보드) | <https://dochi-six.vercel.app> |
| API 베이스 | `https://dochi-six.vercel.app/api/v1` |
| 앱 로그인 진입점 | `https://dochi-six.vercel.app/auth/app/start` |
| 토큰 발급·갱신 | `https://dochi-six.vercel.app/auth/app/token` |
| 이 문서 | <https://dochi-six.vercel.app/api.md> |
| 새 주소 (2026-09-25 추가) | <https://tide-task.vercel.app> — 위 모든 경로가 이 호스트에서도 **똑같이** 동작한다. 위의 `dochi-six` 주소는 **계속 동작한다**. 옮기는 것은 선택이다 |

## 한눈에

- Dochi는 화면 캡처 한 장을 받아 태스크를 **자동으로 만들거나(create)**, 기존 태스크를 **완료 처리(complete)** 한다. 에이전트는 사용자에게 되묻지 않는다.
- 앱은 **이 HTTP API만** 쓴다. Supabase나 LLM을 직접 부르지 않고, 앱에 비밀 키를 싣지 않는다.
- JSON 키는 **카멜케이스**다. 시각은 **ISO 8601**이고 응답은 UTC로 온다.
- 태스크 상태는 `todo`와 `done` 두 가지뿐이다.

## 공통 규약

### 응답 봉투

모든 응답은 아래 두 모양 중 하나다.

```jsonc
{ "data": { ... } }                                            // 성공 (HTTP 200)
{ "error": { "code": "TASK_NOT_FOUND", "message": "태스크를 찾을 수 없습니다." } }  // 실패
```

- `code`는 기계가 읽는 값이고, 앱은 이 값으로 분기한다.
- `message`는 사람이 읽는 한국어 문장이라 알림 본문에 그대로 써도 된다.
- HTTP 상태는 `code`마다 하나로 고정돼 있다(아래 표).

### 에러 코드

| code | HTTP | 뜻 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 토큰이 없거나 만료됐거나 위조됨. 세 경우의 응답이 똑같다 |
| `CONSENT_REQUIRED` | 403 | 개인정보처리방침에 아직 동의하지 않은 계정. 웹뷰에서 동의하면 풀린다(§인증) |
| `VALIDATION_FAILED` | 400 | 요청 형식 오류 |
| `TASK_NOT_FOUND` | 404 | 태스크가 없거나 남의 것 |
| `TAG_NOT_FOUND` | 404 | 태그가 없거나 남의 것 |
| `JOB_LOG_NOT_FOUND` | 404 | 작업 기록이 없거나 남의 것 |
| `TAG_NAME_TAKEN` | 409 | 같은 이름의 태그가 이미 있음 |
| `TAG_PROTECTED` | 409 | '미분류' 태그는 이름을 바꾸거나 지울 수 없음 |
| `REVERT_NOT_POSSIBLE` | 409 | 되돌릴 수 없는 상태. 이유는 `message`에 있다 |
| `AGENT_TIMEOUT` | 504 | 캡처 처리가 10초 예산을 넘김 |
| `INTERNAL_ERROR` | 500 | 그 밖의 서버 오류 |

- **남의 자원은 `403`이 아니라 `404`로 온다.** 없는 자원과 본문까지 똑같다.
- 경로의 `:id`가 UUID 모양이 아니어도 `400`이 아니라 `404`로 온다.
- `NO_TASK_TO_CREATE`·`NO_TASK_TO_COMPLETE`는 에러가 아니다. 캡처 응답의 `200` `data.failure`로 온다(§캡처).

### 인증

```
Authorization: Bearer <accessToken>
```

- `/api/v1/*`의 **모든** 엔드포인트가 이 헤더를 요구한다. `/api/v1/*`는 쿠키를 보지 않는다.
- 헤더는 `Bearer `(B 대문자, 공백 하나)로 시작해야 한다.
- `401`을 받으면 §토큰 갱신을 한 번 시도하고, 그것도 실패하면 로그인 화면을 띄운다.
- 서버는 요청마다 토큰의 계정과 세션이 살아 있는지 확인한다. 다만 앱의 로그아웃은 서버에 닿지 않으므로, 앱이 버린 액세스 토큰도 남은 수명(기본 1시간) 동안 통과한다. **앱이 로그아웃할 때 저장한 토큰을 직접 지운다.** 서버에 로그아웃을 알리는 경로는 없다.
- **사용자가 웹에서 회원 탈퇴를 하면 그 계정의 토큰은 곧바로 `401`이 된다**(2026-09-27부터). 갱신(`POST /auth/app/token`)도 `401`이므로, 앱은 평소의 `401` 처리대로 로그인 화면으로 돌아오면 된다. 탈퇴를 앱 안 웹뷰에서 했다면 웹뷰가 먼저 `/login?signedOut=1`에 도착한다(§웹 로그아웃 신호).
- **개인정보처리방침에 동의하지 않은 계정은 `403 CONSENT_REQUIRED`를 받는다**(2026-09-27부터). 새로 가입한 계정은 첫 로그인 때 웹의 동의 화면(`/consent`)에서 방침 동의와 만 14세 이상 확인을 해야 하고, 그 전에는 `GET /api/v1/me`와 `POST /api/v1/web-session`을 뺀 **모든** `/api/v1/*`이 이 코드로 온다. 그 전에 가입한 계정은 동의한 것으로 처리돼 영향이 없다.
  - 앱이 할 일: 캡처라면 `message`를 알림으로 띄운다(“개인정보처리방침 동의가 필요합니다. Tide 대시보드를 열어 동의해 주세요.”). 대시보드를 열 때는 평소처럼 `web-session`으로 받은 주소를 웹뷰에 연다 — 웹뷰가 알아서 동의 화면으로 간다. 동의가 끝나면 웹뷰는 `/dashboard`에 도착하고, 같은 토큰으로 다시 부르면 통과한다(토큰을 새로 받을 필요 없다).
  - 동의 화면에서 [동의하지 않음]을 누르면 로그아웃이다 — 웹뷰가 `/login?signedOut=1`에 도착한다(§웹 로그아웃 신호).
  - `401`과 섞지 않는다. `403`은 토큰이 멀쩡하다는 뜻이라 갱신하거나 로그아웃시키면 안 된다.

### 시각

- 요청의 시각은 오프셋이 붙은 ISO 문자열이면 무엇이든 받는다(`2026-09-25T18:00:00+09:00`). 서버가 UTC로 정규화한다.
- 응답 시각은 `2026-09-20T05:30:00.123456+00:00`처럼 `+00:00`에 소수 초가 붙어 올 수 있다. 표준 ISO 파서로 읽으면 된다.

## 앱 로그인

앱은 브라우저와 **따로** 자기 세션을 받는다. 흐름은 아래 순서다.

```
1. 앱이 시스템 브라우저를 연다
   GET https://dochi-six.vercel.app/auth/app/start?redirect_uri=dochi://auth/callback&state=<앱이 만든 임의값>

2. 로그인하지 않은 상태라면 웹 로그인 화면이 뜬다(이메일/비밀번호 또는 Google).
   로그인이 끝나면 자동으로 1의 주소로 돌아온다.

3. 브라우저가 앱의 딥링크를 연다
   dochi://auth/callback?code=<일회용 코드>&state=<1에서 보낸 값 그대로>

4. 앱이 코드를 세션으로 바꾼다
   POST https://dochi-six.vercel.app/auth/app/token
   Content-Type: application/json
   { "grantType": "code", "code": "<3에서 받은 code>" }
```

- `redirect_uri`는 **`dochi://auth/callback`과 글자까지 정확히 같아야 한다.** 경로나 쿼리를 덧붙이면 오류 화면이 뜨고 앱으로 돌아가지 않는다. 앱은 `dochi` 스킴을 OS에 등록해야 한다.
- `state`는 선택이지만 보내기를 권한다. 3에서 받은 `state`가 앱이 보낸 값과 다르면 그 응답은 버린다.
- 3에서 `code` 대신 `error=server_error`가 오면 서버가 코드를 만들지 못한 것이다. 로그인을 처음부터 다시 시작한다.
- 코드는 **한 번만 쓸 수 있고 1시간 뒤 만료된다.** 새 코드가 발급되면 이전 코드는 무효가 된다. 받는 즉시 교환한다.
- 브라우저가 이미 로그인된 상태라면 1에서 바로 3으로 넘어간다.

### `POST /auth/app/token`

`/api/v1` 밖에 있는 엔드포인트다. **`Authorization` 헤더 없이** 부른다. 코드 교환과 토큰 갱신을 이 한 곳에서 한다.

| `grantType` | 함께 보낼 키 | 하는 일 |
|---|---|---|
| `code` | `code` | 딥링크로 받은 코드를 세션으로 바꾼다 |
| `refreshToken` | `refreshToken` | 세션을 갱신한다 |

```jsonc
// 요청 예 — 갱신
{ "grantType": "refreshToken", "refreshToken": "<저장해 둔 값>" }

// 응답 — 두 갈래 모두 같은 모양
{
  "data": {
    "accessToken": "eyJ…",                   // Authorization: Bearer 에 싣는다
    "refreshToken": "…",                      // 갱신할 때마다 새 값으로 바뀐다
    "expiresAt": "2026-09-23T06:00:00.000Z",  // accessToken 만료 시각
    "user": { "id": "uuid", "email": "someone@example.com" }
  }
}
```

| 상황 | 응답 | 앱이 할 일 |
|---|---|---|
| 잘못됐거나 만료됐거나 이미 쓴 코드·리프레시 토큰 | `401 UNAUTHORIZED` | 로그인 화면을 띄운다 |
| `grantType`이 둘 중 하나가 아님, 짝이 되는 키가 없음, JSON이 아님 | `400 VALIDATION_FAILED` | 요청을 고친다 |
| 인증 서버 자체의 장애 | `500 INTERNAL_ERROR` | **로그아웃시키지 말고** 나중에 다시 시도한다 |

- ⚠️ **리프레시 토큰은 한 번 쓰면 바뀐다(회전).** 갱신 응답의 `refreshToken`을 받는 즉시 저장값에 덮어쓴다. 옛 값을 다시 쓰면(10초 유예 뒤) 세션 전체가 폐기된다. 갱신 요청을 동시에 두 번 보내지 않는다.
- 웹에서 로그아웃해도 앱 세션은 유지되고, 반대도 마찬가지다.

### `GET /api/v1/me`

현재 토큰이 유효한지, 어느 계정인지 확인한다.

```jsonc
{ "data": { "id": "uuid", "email": "someone@example.com" } }
```

### `POST /api/v1/web-session` — 앱 안 웹뷰에 로그인 이어주기

앱 세션과 웹뷰(대시보드)의 로그인은 **서로 다른 세션**이다. 이어 주지 않으면 앱 로그인 뒤에도 웹뷰가 웹 로그인 화면을 한 번 더 띄우고, macOS 웹뷰에서는 그 화면의 Google 로그인이 끝나지 않는다(Google이 앱 내장 웹뷰 로그인을 막는다). 이 엔드포인트가 웹뷰용 **일회용 로그인 주소**를 준다.

```jsonc
// 요청 — Authorization: Bearer 필수. 본문은 선택이다
{ "next": "/history?log=<jobLogId>" }   // 로그인 뒤 갈 곳. 생략하면 /dashboard

// 응답
{ "data": { "url": "https://dochi-six.vercel.app/auth/callback?token_hash=…&type=magiclink&next=%2Fdashboard" } }
```

- 받은 `url`을 **웹뷰에서 그대로 연다.** 웹뷰가 로그인된 채 `next`에 도착한다.
- **언제 부르나** — ① 앱 로그인(`POST /auth/app/token` 코드 교환)이 **끝난 직후** ② 웹뷰가 `/login`에 도착했을 때(웹뷰 세션이 만료됐다는 뜻이다).
- ⚠️ **코드 교환보다 먼저 부르지 않는다.** 새 주소가 발급되면 아직 교환하지 않은 딥링크 코드가 무효가 된다.
- 주소는 **한 번만 쓸 수 있고 1시간 뒤 만료된다.** 두 번째로 열면 로그인 화면(“링크가 만료되었거나 이미 사용되었습니다”)이 뜬다. 필요할 때마다 새로 받는다. 주소를 로그에 남기지 않는다.
- `next`는 `/`로 시작하는 사이트 안 경로만 받는다. 그 밖의 값은 `/dashboard`로 바뀐다.

| 상황 | 응답 | 앱이 할 일 |
|---|---|---|
| 토큰 없음·만료 | `401 UNAUTHORIZED` | 평소처럼 갱신 후 한 번 더 |
| 서버가 주소를 만들지 못함 | `500 INTERNAL_ERROR` | 웹뷰를 그대로 둔다(웹 로그인 화면이 대신한다) |

### 웹 로그아웃 신호 — `/login?signedOut=1`

사용자가 대시보드에서 **직접** 로그아웃하면 웹은 `/login?signedOut=1`로 보낸다(2026-09-27부터). 회원 탈퇴도 같은 주소로 끝난다. 웹 세션이 만료돼서 오는 로그인 화면은 그냥 `/login`이다(뒤에 `?next=…`·`?error=…`가 붙을 수는 있어도 `signedOut`은 붙지 않는다).

- 웹뷰가 `signedOut=1`이 붙은 `/login`에 도착하면 **사용자가 로그아웃한 것**이다. 앱도 저장한 토큰을 지우고 로그인 화면으로 돌아간다.
- 이 도착은 위 `web-session` §언제 부르나의 ②(세션 만료)가 **아니다** — `web-session`을 부르지 않는다. 부르면 방금 로그아웃한 계정으로 웹뷰가 다시 로그인된다.
- 서버의 앱 세션은 이 신호로 끊기지 않는다(웹 로그아웃은 그 브라우저의 세션만 닫는다). 앱이 토큰을 지워야 끝난다.

## 캡처 — `POST /api/v1/captures`

캡처 한 장을 올리면 태스크를 만들거나 완료한다. 앱의 핵심 엔드포인트다.

```
POST /api/v1/captures
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `image` | file | ✅ | PNG·JPEG·WebP, **4MB 이하**. 서버는 이미지를 저장하지 않는다 |
| `mode` | `create` \| `complete` | ✅ | 사용자가 누른 단축키. `create`는 생성, `complete`는 완료 |
| `capturedAt` | ISO 8601 | ✅ | 캡처한 시각. '내일' 같은 상대 날짜를 계산하는 기준이다 |
| `timezone` | IANA 이름 (`Asia/Seoul`) | ✅ | 사용자 시간대. 유효한 캡처 요청마다 계정의 기본 시간대도 이 값으로 갱신된다(웹 대시보드의 날짜 표시가 이 값을 쓴다) |

- 📱 **`image` 파트에 Content-Type(`image/png`·`image/jpeg`·`image/webp`)을 반드시 붙인다.** 서버는 파트의 타입을 그대로 믿는다. Flutter `http`의 `MultipartFile`은 따로 지정하지 않으면 `application/octet-stream`을 보내서 `400`이 난다. `contentType: MediaType('image', 'png')`처럼 지정한다.
- 📱 **긴 변을 2048px 이하로 줄여서 보낸다.** 모델이 어차피 그 크기로 줄여 읽기 때문에 잃는 정보가 없고, 4MB 제한에도 걸리지 않는다.
- 📱 **앱의 HTTP 타임아웃은 15초 이상으로 잡는다.** 서버 예산은 10초지만 저장에 1초 가까이 더 걸릴 수 있다.
- 네 필드 중 하나라도 없거나 틀리면 `400 VALIDATION_FAILED`가 온다. 이 경우 에이전트를 부르지 않아 작업 로그도 남지 않는다.

### 응답

알림은 이 응답 하나로 만들 수 있다.

```jsonc
{
  "data": {
    "jobLogId": "uuid",
    "outcome": "created",            // "created" | "completed" | "failed"
    "created": [                     // mode=create일 때. 한 캡처에서 여러 개가 나올 수 있다
      {
        "id": "uuid",
        "title": "제안서 초안 보내기",
        "dueAt": "2026-09-25T14:59:59+00:00",   // 마감이 드러나지 않으면 null
        "dueHasTime": false,                    // false면 날짜만 보여 준다
        "tags": ["업무"],                        // 태그 '이름' 배열. 비지 않으며 최소 ["미분류"]
        "rationale": "메일 본문에 '금요일까지 초안 부탁'이 있음"
      }
    ],
    "completed": null,               // mode=complete일 때 { "id": "uuid", "title": "..." } 또는 null
    "duplicates": [],                // 이미 있어서 만들지 않은 태스크 [{ "id": "uuid", "title": "..." }]. 항상 오고, 없으면 []
    "failure": null                  // 할 일을 못 찾으면 { "code": "...", "message": "..." }
  }
}
```

- `mode: create`면 `completed`는 항상 `null`이다. `mode: complete`면 `created`는 항상 `[]`다.
- `created`가 여러 개면 건마다 알림을 띄운다.
- 에이전트는 기존 태그를 우선 쓰지만, 알맞은 태그가 없으면 **새 태그를 만들 수 있다.**
- `duplicates`는 캡처의 할 일이 **이미 있는 미완료 태스크와 같은 일이라 새로 만들지 않은 것**이다. 항목은 그 기존 태스크의 `id`·`title`이다. 언제나 배열로 오고(없으면 `[]`, `mode: complete`면 늘 `[]`), 같은 태스크가 두 번 들어 있지 않다.
- 할 일이 **전부** 이미 있으면 `outcome: "failed"` + `failure.code: "DUPLICATE_TASK"`다. **일부만** 이미 있으면 `outcome: "created"`인 채로 `created`와 `duplicates`가 둘 다 찬다. 이미 있는 태스크로 가는 [대시보드 바로가기]는 `duplicates[0].id`로 건다.

### 결과 분기

앱은 HTTP 상태와 `outcome` 두 값만 보고 분기하면 된다.

| HTTP | 모양 | 뜻 | 서버에 반영된 것 |
|---|---|---|---|
| `200` | `outcome: "created"` | 태스크를 1개 이상 만들었다 | `created[]` 전부 |
| `200` | `outcome: "completed"` | 태스크 하나를 `done`으로 바꿨다 | `completed` |
| `200` | `outcome: "failed"`, `failure.code: "NO_TASK_TO_CREATE"` | 캡처에서 할 일을 찾지 못했다 (`message`: "생성할 태스크가 없어요.") | 없음 |
| `200` | `outcome: "failed"`, `failure.code: "NO_TASK_TO_COMPLETE"` | 완료할 태스크를 찾지 못했다 (`message`: "완료할 태스크를 찾지 못했어요.") | 없음 |
| `200` | `outcome: "failed"`, `failure.code: "DUPLICATE_TASK"` | 할 일이 전부 이미 있는 미완료 태스크와 같다 (`message`: "이미 있는 태스크예요: {제목}", 여럿이면 "… 외 N건") | 없음 — 이미 있는 것은 `duplicates` |
| `400` | `VALIDATION_FAILED` | 요청 형식이 틀렸다 | 없음 |
| `401` | `UNAUTHORIZED` | 토큰에 문제가 있다 | 없음 |
| `504` | `AGENT_TIMEOUT` | 10초 예산을 넘겼다 | **없음이 보장된다** |
| `500` | `INTERNAL_ERROR` | 그 밖의 오류 | 드물게 생성 일부가 남을 수 있다 |

`504`와 `500`은 에러 봉투로 오기 때문에 `jobLogId`가 없다.

## 태스크

### 태스크 객체

목록·조회·생성·수정이 모두 같은 모양을 돌려준다.

```jsonc
{
  "id": "uuid",
  "title": "제안서 초안 보내기",
  "description": "초안 v2",              // 없으면 null
  "dueAt": "2026-09-22T09:00:00+00:00",  // 없으면 null
  "dueHasTime": true,
  "status": "todo",                     // "todo" | "done"
  "rationale": "…",                     // 에이전트가 이렇게 판단한 근거 한 문장. 직접 만든 태스크면 null
  "source": "capture_create",           // "capture_create" | "mail" | "manual"
  "jobLogId": "uuid",                   // 직접 만든 태스크면 null
  "tags": [ { "id": "uuid", "name": "업무" } ],   // 이름순. 없으면 []
  "createdAt": "…",
  "updatedAt": "…"
}
```

- **날짜만 있는 마감**('9/21까지')은 `dueAt`이 사용자 시간대 기준 그날 23:59:59이고 `dueHasTime`이 `false`다. 화면에는 시각을 빼고 날짜만 보여 준다. `dueAt`이 `null`이면 `dueHasTime`은 항상 `false`다.
- 완료 캡처는 태스크를 새로 만들지 않는다. 그래서 `source`에는 `capture_complete`가 나오지 않는다.

### 엔드포인트

| 메서드 | 경로 | 응답 `data` |
|---|---|---|
| `GET` | `/api/v1/tasks` | 태스크 배열 |
| `POST` | `/api/v1/tasks` | 만든 태스크 |
| `GET` | `/api/v1/tasks/:id` | 태스크 |
| `PATCH` | `/api/v1/tasks/:id` | 바뀐 태스크 |
| `DELETE` | `/api/v1/tasks/:id` | `{ "id": "uuid" }` |

**`GET /api/v1/tasks`**

- `?status=todo|done`: 선택. 그 밖의 값이면 빈 값이어도 `400`이다.
- `?tagId=<uuid>`: 선택. 그 태그가 달린 태스크만 돌려준다. 각 태스크의 `tags`는 걸러지지 않고 전부 온다. 없는 태그나 남의 태그면 `[]`, UUID 모양이 아니면 `400`이다.
- 정렬: `todo`가 먼저, 그다음 `done`이다. 각 묶음 안에서는 `dueAt` 오름차순이고 `dueAt`이 없는 것은 맨 끝에 온다. 마감이 같으면 먼저 만든 것이 앞이다. 페이지네이션은 없다.

**`POST /api/v1/tasks`**: 사용자가 직접 만드는 태스크(`source: "manual"`)다.

```jsonc
{
  "title": "제안서 보내기",                  // 필수. 앞뒤 공백을 걷고 비어 있으면 400
  "description": "초안 v2",                // 선택. 빈 문자열은 null로 저장
  "dueAt": "2026-09-25T18:00:00+09:00",    // 선택
  "dueHasTime": true,                      // 선택. dueAt과 함께만 보낸다(혼자 오면 400). 생략하면 true
  "tagIds": ["uuid"]                       // 선택
}
```

- `status`는 받지 않는다. 새 태스크는 항상 `todo`로 시작한다.
- `tagIds`에 없거나 남의 태그가 하나라도 섞이면 `400`이고, 태스크도 만들어지지 않는다.

**`PATCH /api/v1/tasks/:id`**: 보낸 키만 바꾼다.

| 키 | 값 | 비고 |
|---|---|---|
| `title` | 문자열 | 비어 있으면 `400` |
| `description` | 문자열 \| `null` | `null`이나 빈 문자열이면 비운다 |
| `dueAt` | ISO 8601 \| `null` | `null`이면 마감을 지운다 |
| `dueHasTime` | boolean | **`dueAt`과 함께만** 보낸다. 생략하면 `true`다. 혼자 오거나 `dueAt: null`과 함께 `true`가 오면 `400` |
| `status` | `todo` \| `done` | 완료·미완료 전환 |
| `tagIds` | UUID 배열 | **통째로 교체**한다. `[]`면 태그를 전부 뗀다. 없거나 남의 태그가 섞이면 `400` |

- 바꿀 키가 하나도 없으면 `400`이다. `rationale`·`source`·`jobLogId`는 받지 않고 조용히 무시한다.
- 드물게 `500`이 나면 일부만 바뀌었을 수 있다. 같은 PATCH를 다시 보내면 결과가 같아진다(멱등).

**`DELETE /api/v1/tasks/:id`**: 태스크를 지운다. 거기 달려 있던 태그는 남는다.

## 태그

### 태그 객체

```jsonc
{ "id": "uuid", "name": "업무", "createdAt": "…" }
```

### 엔드포인트

| 메서드 | 경로 | 본문 | 응답 `data` |
|---|---|---|---|
| `GET` | `/api/v1/tags` | | 태그 배열(이름순) |
| `POST` | `/api/v1/tags` | `{ "name": "업무" }` | 만든 태그 |
| `PATCH` | `/api/v1/tags/:id` | `{ "name": "새 이름" }` | 바뀐 태그 |
| `DELETE` | `/api/v1/tags/:id` | | `{ "id": "uuid" }` |
| `POST` | `/api/v1/tags/merge` | `{ "sourceId": "uuid", "targetId": "uuid" }` | 남은 태그(`targetId` 쪽) |

- 이름은 앞뒤 공백을 걷는다. 비어 있으면 `400`이다. 이름은 사용자마다 유일하고, 같은 이름이 이미 있으면 `409 TAG_NAME_TAKEN`이다.
- 태그를 지워도 태스크는 남고 그 태그만 떨어진다.
- **'미분류'** 태그는 가입할 때 자동으로 생긴다. 에이전트가 태그를 정하지 못할 때 쓰는 태그다. 이름을 바꾸거나 지우려 하면 `409 TAG_PROTECTED`다.

### 태그 합치기

`POST /api/v1/tags/merge`는 태그 둘을 하나로 합친다. 응답은 **남은 태그 한 건**이고, 그 `id`와 `createdAt`은 합치기 전과 같다(새로 만들지 않는다).

- `sourceId` 태그는 **사라지고**, 거기 달려 있던 할 일은 `targetId` 태그를 갖는다. **할 일은 한 건도 사라지지 않는다.**
- 둘 다 달려 있던 할 일에는 `targetId` 태그가 **한 번만** 남는다.
- **같은 요청을 두 번 보내면 두 번째는 `404 TAG_NOT_FOUND`다.** 출발 태그가 이미 없기 때문이다.
- **'미분류'는 `sourceId`로 쓸 수 없다** — `409 TAG_PROTECTED`다. `targetId`로 쓰는 것은 된다(태그가 사라지지 않으므로).
- 둘 중 하나라도 없거나 남의 태그면 `404 TAG_NOT_FOUND`다. 남의 '미분류'를 넣어도 `TAG_PROTECTED`가 아니라 `404`다.
- 두 값이 같거나 빠졌거나 UUID 모양이 아니면 `400 VALIDATION_FAILED`다.
- 태그 목록을 들고 있다면 합치기 뒤에 다시 받는다 — 사라진 `id`가 손에 남아 있을 수 있다.

## 작업 로그

에이전트가 캡처나 메일 한 건을 처리한 기록이다. 캡처 응답의 `jobLogId`가 여기 항목의 `id`와 같다.

### 작업 로그 객체

```jsonc
{
  "id": "uuid",
  "createdAt": "2026-09-24T03:00:00Z",
  "source": "capture_create",       // capture_create · capture_complete · mail
  "outcome": "created",             // created · completed · failed
  "failureReason": null,            // 실패면 에러 코드 문자열, 아니면 null
  "captureSummary": "노트 앱에 적힌 할 일 두 가지.",   // null일 수 있다
  "rationale": null,                // 완료 처리의 근거 한 문장. 그 밖에는 null
  "handledAt": null,                // 웹의 '확인 필요'에서 처리한 시각. 아니면 null (2026-09-25 추가)
  "tasks": [ { "id": "uuid", "title": "교양 발표 PPT 만들기" } ],
  "revertable": true                // 지금 되돌릴 수 있으면 true
}
```

- `tasks`는 **그 처리가 만들었거나 닫은** 태스크다. 생성이면 만든 것 전부, 완료면 닫은 것 하나, 실패면 빈 배열이다. 배열은 하나뿐이고 어느 쪽인지는 `source`가 말한다.
- 지워진 태스크는 배열에서 사라진다. 그래서 성공한 처리인데 `tasks`가 빌 수 있다.
- `rationale`은 **완료 처리에서만** 찬다. 생성의 근거는 태스크 객체의 `rationale`에 있다.
- `captureSummary`는 시간 초과나 서버 오류로 끝난 기록에서 `null`이다 — 요약이 모델 출력에서만 나오기 때문이다.
- `revertable`은 **되돌리기 버튼을 보여 줄지**를 정하는 값이다. 참고값이라 실제 되돌리기는 다시 판정한다 — `true`였는데 `409`가 올 수 있고, 그때는 `message`를 그대로 띄운다.
- `handledAt`은 **2026-09-25에 추가된 칸**이다. 웹 대시보드의 '확인 필요'에서 사용자가 실패한 캡처를 처리한 시각이다 — 그 캡처로 태스크를 직접 만들었거나 [넘기기]를 눌렀을 때 찬다. 처리해도 기록은 지워지지 않고 이 목록에 그대로 남는다. 앱은 쓰지 않아도 되며, 이 값을 바꾸는 경로는 없다.

### 엔드포인트

| 메서드 | 경로 | 응답 `data` |
|---|---|---|
| `GET` | `/api/v1/job-logs` | 작업 로그 배열(최신순) |
| `POST` | `/api/v1/job-logs/:id/revert` | `{ jobLogId, reverted, taskIds }` |

**`GET /api/v1/job-logs`**

- 최신 **100건**을 돌려준다. 쿼리도 페이지네이션도 없다.
- 본인 기록만 온다. 토큰이 없으면 `401`이다.

**`POST /api/v1/job-logs/:id/revert`**

에이전트가 한 일을 되돌린다. **요청 본문이 없다** — 무엇을 되돌릴지는 그 기록의 `outcome`이 정한다.

```jsonc
{
  "data": {
    "jobLogId": "uuid",
    "reverted": "created",          // created · completed
    "taskIds": [ "uuid" ]           // 실제로 바뀐 태스크. 만든 순서
  }
}
```

- `reverted`가 `created`면 `taskIds`의 태스크가 **지워졌고**, `completed`면 **할 일로 돌아갔다**.
- **두 번 부르면 `409`다.** 성공했다면 같은 기록을 다시 되돌릴 것이 없다.
- **생성 되돌리기는 전부 아니면 전무다.** 한 기록이 태스크 여러 개를 만들 수 있는데, 하나라도 그 뒤에 바뀌었으면 **한 건도 지우지 않고** 거절한다.
- 태스크가 지워지면 태그 연결도 함께 사라진다. 태그 자체는 남는다.
- 완료를 되돌려도 그 태스크는 기록의 `tasks`에 계속 실린다 — 무엇을 되돌렸는지 보이게.
- 되돌릴 수 없으면 `409` `REVERT_NOT_POSSIBLE`이고 이유는 `message`로 갈린다. 네 가지다.
  - `생성 이후 태스크가 변경되어 되돌릴 수 없습니다.`
  - `되돌릴 태스크가 남아 있지 않습니다.` — 지워졌거나, 이미 되돌렸거나, 다른 처리가 그 태스크를 다시 닫았다.
  - `이미 되돌린 작업입니다.`
  - `되돌릴 내용이 없는 기록입니다.` — 실패로 끝난 기록이다.
- 없는 기록·남의 기록·UUID 모양이 아닌 `:id`는 **본문까지 똑같은** `404` `JOB_LOG_NOT_FOUND`다.
- 토큰이 없으면 `401`이다.

## 아직 없는 것

아래 기능은 아직 구현되지 않았으니 호출하지 않는다. 지금 부르면 봉투 없는 `404`나 `405`가 온다.

| 기능 | 경로(예정) | 시기 |
|---|---|---|
| 서버발 이벤트(메일 소스 결과 알림) | 미정 | P2 |

## 변경 규칙

- 선택 필드를 더하는 변경은 예고 없이 들어올 수 있다. **모르는 키는 무시하도록** 파싱한다.
- 🔴 **`failure.code`에 값이 늘 수 있다.** 모르는 값이 오면 분기하지 말고 **`message`를 알림 본문에 그대로 띄운다** — `message`는 언제나 사용자에게 보여 줄 수 있는 한국어 문장이다. `outcome`의 값(`created`·`completed`·`failed`)은 늘지 않으므로 분기는 그쪽으로 한다.
- 필드를 빼거나 의미·경로를 바꾸는 변경은 앱 쪽과 합의한 뒤 `/api/v2`로 낸다.
