import type { ReactNode } from "react";

import { TideLogo } from "@/components/icons";
import { cardClass } from "@/components/ui";

export const metadata = { title: "개인정보처리방침 · Tide" };

/**
 * 개인정보처리방침 전문(HF-06). **로그인 없이 열린다** — 동의 화면(`/consent`)이 여기를 가리키고,
 * 가입 전에도 읽을 수 있어야 한다.
 *
 * 원문은 개인정보 보호책임자(김주안)가 쓴 2026-09-26 초안이다. 실제 동작과 어긋난 곳 여섯 군데를
 * 고쳐 올렸다 — 목록과 경위는 `docs/ROADMAP.md` HF-06. **문장을 바꿀 때는 보호책임자 확인을 받는다.**
 * 여기가 방침의 정본이고, 사실(수집 항목·위탁처·보관 방식)이 바뀌면 이 페이지도 함께 고친다.
 *
 * HF-07에서 제7조(국외 이전)를 새로 넣고 제5조에 "탈퇴해도 바로 지워지지 않는 것"을 적었다(보호책임자
 * 요청). 보관 기간(백업 7일·OpenAI 30일·접속 로그 1일)은 Supabase Pro · Vercel Pro · `store: false`
 * 기준이다 — 요금제나 OpenAI 호출 설정이 바뀌면 제5조와 `TRANSFERS`를 같이 고친다.
 */

function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-h2 text-ink">{title}</h2>
      {children}
    </section>
  );
}

function List({ ordered = false, children }: { ordered?: boolean; children: ReactNode }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`flex flex-col gap-2 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
      {children}
    </Tag>
  );
}

const TRUSTEES = [
  ["OpenAI, L.L.C.", "전송된 이미지의 AI 분석 (OpenAI API)", "이미지, 캡처 시각·시간대·요청 종류"],
  [
    "Supabase, Inc.",
    "회원 정보 및 서비스 데이터 저장(데이터베이스·인증)",
    "이메일, 이름, 프로필 사진, 암호화된 비밀번호(이메일 가입 시), 서비스 이용 데이터",
  ],
  ["Vercel Inc.", "서비스(웹/앱) 호스팅 및 운영", "접속 로그 등 서비스 운영에 필요한 정보"],
  ["Google LLC", "소셜 로그인(OAuth) 인증 (Google 로그인 이용 시)", "이메일, 이름, 프로필 사진"],
] as const;

// 제7조 표. 보유 기간은 요금제에 매여 있다(Vercel Pro 실행 로그 1일) — 플랜이 바뀌면 이 표와 제5조도 고친다.
const TRANSFERS = [
  {
    company: "OpenAI, L.L.C. (미국)",
    contact: "https://openai.com/policies/privacy-policy",
    data: "이미지(이미지에 표시된 모든 내용 포함), 캡처 시각·시간대·요청 종류",
    when: "이용자가 이미지를 전송할 때마다 암호화된 통신(HTTPS)으로 OpenAI API에 전송",
    purpose: "이미지를 분석하여 할 일을 만들거나 완료 처리",
    period:
      "오남용 모니터링을 위해 최대 30일 보관 후 삭제(법률상 필요한 경우 연장될 수 있음). 모델 학습에 이용되지 않음",
  },
  {
    company: "Vercel Inc. (미국)",
    contact: "https://vercel.com/legal/privacy-policy",
    data: "접속 로그(IP 주소, 브라우저 정보, 요청 경로, 접속 일시)",
    when: "서비스에 접속할 때마다 자동으로 기록",
    purpose: "서비스 호스팅 및 운영, 오류 확인",
    period: "최대 1일 보관 후 삭제",
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <div className="flex justify-center">
        <TideLogo height={24} />
      </div>

      <article
        className={`${cardClass} flex flex-col gap-8 px-6 py-8 text-body text-ink [&_li]:text-body`}
      >
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-h1 text-ink">개인정보처리방침</h1>
          <p className="text-body-s text-ink-secondary">시행일 2026년 9월 27일</p>
        </header>

        <Article title="제1조 (수집하는 개인정보의 항목)">
          <p>Tide(이하 &lsquo;회사&rsquo; 또는 &lsquo;서비스&rsquo;)는 다음과 같은 개인정보를 수집합니다.</p>
          <List ordered>
            <li>
              <strong>회원가입 시</strong>
              <List>
                <li>
                  Google 로그인: 이메일 주소, 이름, 프로필 사진 (Google 계정 인증 시 요청하는
                  권한(scope): <code>email</code>, <code>profile</code>)
                </li>
                <li>
                  이메일 가입: 이메일 주소, 비밀번호 (비밀번호는 암호화되어 저장되며, 회사도 원문을
                  알 수 없습니다)
                </li>
              </List>
            </li>
            <li>
              <strong>서비스 이용 과정에서 생성·수집</strong>
              <List>
                <li>이용자가 전송하는 이미지(캡처 화면 등) — 분석에만 쓰며 저장하지 않습니다</li>
                <li>이미지 처리를 위해 함께 전송되는 정보: 캡처 시각, 시간대, 요청 종류</li>
                <li>
                  분석 결과로 만들어진 할 일(제목·설명·마감일·태그), 그 근거가 된 캡처 내용을 요약한
                  한 문장, 처리 기록
                </li>
                <li>서비스 이용기록, 접속 로그</li>
              </List>
            </li>
            <li>
              <strong>첫 로그인 시 확인 항목</strong>
              <List>
                <li>만 14세 이상 여부 (동의 화면에서 확인)</li>
              </List>
            </li>
          </List>
        </Article>

        <Article title="제2조 (개인정보의 수집 방법)">
          <p>회사는 다음과 같은 방법으로 개인정보를 수집합니다.</p>
          <List>
            <li>이용자가 Google 소셜 로그인 또는 이메일로 회원가입 및 로그인하는 과정에서 수집</li>
            <li>이용자가 서비스 내에서 이미지를 전송하는 과정에서 수집</li>
            <li>서비스 이용 과정에서 자동으로 생성되어 수집</li>
          </List>
        </Article>

        <Article title="제3조 (기기에 저장되는 정보)">
          <p>
            Tide는 로그인 정보와 진단 로그를 이용자 기기에만 저장합니다. 이 정보는 자동으로 서버에
            전송되지 않으며, 회사는 해당 정보에 접근할 수 없습니다. 진단 로그에는 캡처로 생성된
            태스크 제목과 처리 시각이 포함될 수 있습니다. 이용자가 앱을 삭제(제거)하면 위 정보도 함께
            삭제됩니다.
          </p>
        </Article>

        <Article title="제4조 (개인정보의 수집 및 이용 목적)">
          <p>
            회사는 수집한 개인정보를 다음의 목적을 위해 이용합니다. 목적이 변경되는 경우에는 별도의
            동의를 받는 등 필요한 조치를 이행합니다.
          </p>
          <List ordered>
            <li>
              <strong>회원 관리</strong>: 회원제 서비스 이용에 따른 본인 확인, 개인 식별, 만 14세 이상
              여부 확인, 부정 이용 방지
            </li>
            <li>
              <strong>서비스 제공</strong>: 이용자가 전송한 이미지를 AI(OpenAI API)로 분석하여 요청한
              결과를 제공
            </li>
            <li>
              <strong>서비스 개선 및 안정적 운영</strong>: 오류 진단, 접속 빈도 파악, 서비스 이용 통계
              분석 (개인을 식별하지 않는 범위 내에서 처리)
            </li>
            <li>
              <strong>고지 및 안내</strong>: 서비스 변경사항, 정책 변경 등 공지사항 전달
            </li>
          </List>
        </Article>

        <Article title="제5조 (개인정보의 보유 및 이용기간)">
          <List ordered>
            <li>
              회사는 원칙적으로 개인정보의 수집 및 이용목적이 달성된 후에는 해당 정보를 지체 없이
              파기합니다.
            </li>
            <li>
              회원 탈퇴 시 회사 데이터베이스에 있는 이용자의 계정 정보 및 관련 데이터는{" "}
              <strong>즉시 자동으로 전부 삭제</strong>됩니다. 별도의 유예기간 없이 탈퇴 즉시
              파기되며, 이후 복구되지 않습니다. 다만 다음 정보는 탈퇴 즉시 삭제되지 않고, 아래 기간이
              지나면 자동으로 삭제됩니다.
              <List>
                <li>
                  <strong>데이터베이스 백업</strong>: 장애 복구를 위해 Supabase가 매일 만드는 백업에
                  최대 7일간 남아 있다가 삭제됩니다.
                </li>
                <li>
                  <strong>OpenAI로 전송된 이미지 등</strong>: 최대 30일간 보관된 뒤 OpenAI의 정책에
                  따라 삭제됩니다(법률상 필요한 경우 더 길어질 수 있습니다).
                </li>
                <li>
                  <strong>접속 로그</strong>: Vercel에 최대 1일간 보관된 뒤 삭제됩니다.
                </li>
              </List>
            </li>
            <li>
              <strong>
                국외로 이전된 데이터(제7조)는 이전받은 업체가 각자의 정책에 따라 보관하며, 회사가 직접
                삭제할 수 있는 관할 밖에 있습니다. 따라서 회원 탈퇴 시 바로 삭제되지 않습니다.
              </strong>{" "}
              회사는 해당 업체에 개별 데이터의 삭제를 요청할 수단이 없으며, 위 보관 기간이 지나면 각
              업체의 정책에 따라 삭제됩니다.
            </li>
            <li>
              로그인 정보 및 진단 로그는 이용자 기기에만 저장되며, 회사는 별도로 수집·보관하지
              않습니다. 자세한 내용은 제3조(기기에 저장되는 정보)를 참고하시기 바랍니다.
            </li>
            <li>
              관계 법령에 따라 보존할 의무가 있는 경우, 관련 법령에서 정한 기간 동안 개인정보를
              보관합니다.
            </li>
          </List>
        </Article>

        <Article title="제6조 (개인정보의 제3자 제공 및 처리위탁)">
          <p>
            ① 회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 서비스 제공을
            위해 아래와 같이 외부 업체에 처리를 위탁하고 있습니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-s">
              <thead>
                <tr className="bg-subtle text-left text-ink-secondary">
                  <th className="border border-line px-3 py-2">수탁업체</th>
                  <th className="border border-line px-3 py-2">위탁업무 내용</th>
                  <th className="border border-line px-3 py-2">처리(보관)하는 정보</th>
                </tr>
              </thead>
              <tbody>
                {TRUSTEES.map(([company, work, data]) => (
                  <tr key={company}>
                    <td className="border border-line px-3 py-2">{company}</td>
                    <td className="border border-line px-3 py-2">{work}</td>
                    <td className="border border-line px-3 py-2">{data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            ② 회사는 OpenAI API 이용 시 이미지 데이터를 AI 모델 학습 목적으로 제공하지 않도록
            설정하여 운영하고 있으며, OpenAI의 정책에 따라 부정 이용 모니터링 등을 위한 최소한의 기간
            동안만 처리사가 보관할 수 있습니다. ③ 위탁업체는 위탁 목적 범위를 초과하여 개인정보를
            이용하거나 제3자에게 제공하지 않습니다. ④ 처리위탁 계약 및 서비스 내용은 위탁업체의 정책
            변경 등에 따라 달라질 수 있으며, 변경 시 본 방침을 통해 고지합니다.
          </p>
        </Article>

        <Article title="제7조 (개인정보의 국외 이전)">
          <p>
            ① 회사는 서비스 제공을 위해 다음과 같이 개인정보를 국외로 이전합니다. 회원 정보와 할 일 등
            서비스 데이터를 저장하는 데이터베이스(Supabase)는 대한민국(서울)에 있어 국외 이전에
            해당하지 않습니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-s">
              <thead>
                <tr className="bg-subtle text-left text-ink-secondary">
                  <th className="border border-line px-3 py-2">이전받는 자(국가)</th>
                  <th className="border border-line px-3 py-2">이전되는 항목</th>
                  <th className="border border-line px-3 py-2">이전 시기 및 방법</th>
                  <th className="border border-line px-3 py-2">이용 목적</th>
                  <th className="border border-line px-3 py-2">보유·이용 기간</th>
                </tr>
              </thead>
              <tbody>
                {TRANSFERS.map((t) => (
                  <tr key={t.company}>
                    <td className="border border-line px-3 py-2">
                      {t.company}
                      <br />
                      <a href={t.contact} className="text-brand underline hover:text-brand-hover">
                        개인정보처리방침·문의처
                      </a>
                    </td>
                    <td className="border border-line px-3 py-2">{t.data}</td>
                    <td className="border border-line px-3 py-2">{t.when}</td>
                    <td className="border border-line px-3 py-2">{t.purpose}</td>
                    <td className="border border-line px-3 py-2">{t.period}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            ② 위 이전은 이용자와 체결한 서비스 이용 계약을 이행하기 위한 처리위탁으로서, 「개인정보
            보호법」 제28조의8에 따라 본 방침에 공개합니다.
          </p>
          <p>
            ③ <strong>국외로 이전된 데이터는 회사의 관할 밖에 있습니다.</strong> 회사는 이전받은 업체에
            개별 데이터의 삭제를 요청할 수단이 없으므로, 회원 탈퇴 시에도 이미 이전된 데이터는 바로
            삭제되지 않고 위 보유 기간이 지나면 각 업체의 정책에 따라 삭제됩니다(제5조 참고).
          </p>
          <p>
            ④ <strong>거부 방법 및 효과</strong>: 이미지를 전송하지 않으면 OpenAI로의 이전은 이루어지지
            않습니다. 국외 이전을 거부하려면 제11조의 개인정보 보호책임자 이메일로 알리거나 회원
            탈퇴를 할 수 있습니다. 다만 이미지 분석은 서비스의 핵심 기능이고 접속 로그는 서비스 운영에
            필수적이므로, 거부하면 서비스를 이용할 수 없습니다.
          </p>
        </Article>

        <Article title="제8조 (정보주체의 권리·의무 및 행사방법)">
          <List ordered>
            <li>
              이용자는 언제든지 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요구할 수 있습니다.
            </li>
            <li>
              권리 행사는 아래 개인정보 보호책임자 이메일로 요청하실 수 있으며, 회사는 요청을 확인한 후
              지체 없이 조치합니다.
            </li>
            <li>
              <strong>회원탈퇴 방법</strong>: 이용자는 서비스 내 탈퇴 기능 또는 이메일 요청을 통해
              탈퇴할 수 있습니다. 탈퇴 요청 시 회사는 데이터베이스(Supabase)에서 해당 계정 및 관련
              데이터를 확인 즉시 전부 삭제합니다. 즉시 삭제되지 않는 정보와 그 보관 기간은 제5조를
              참고하시기 바랍니다.
            </li>
            <li>
              이용자는 개인정보의 수집·이용에 대한 동의를 철회할 수 있으며, 이 경우 서비스 이용에
              제한이 있을 수 있습니다.
            </li>
          </List>
        </Article>

        <Article title="제9조 (개인정보의 안전성 확보조치)">
          <p>회사는 개인정보보호법에 따라 다음과 같은 안전성 확보조치를 취하고 있습니다.</p>
          <List ordered>
            <li>
              <strong>접근 권한 관리</strong>: 현재 관리자 계정 1개만 데이터베이스에 접근 가능하도록
              제한하고 있습니다.
            </li>
            <li>
              <strong>캡처 이미지 비저장</strong>: 이용자가 전송한 이미지는 AI 분석에만 쓰고, 서버의
              데이터베이스·저장소·디스크·로그 어디에도 저장하지 않습니다. 남는 것은 분석 결과인 할 일과
              근거 한 문장, 처리 기록뿐입니다.
            </li>
            <li>
              <strong>진단 로그 관리</strong>: 진단 로그는 이용자 기기에만 저장되며 회사 서버로
              전송되지 않습니다(제3조 참고).
            </li>
            <li>
              회사는 서비스의 안전성을 지속적으로 점검하고, 필요한 경우 데이터베이스 접근 통제 등 보안
              조치를 추가로 강화해 나갑니다.
            </li>
          </List>
        </Article>

        <Article title="제10조 (만 14세 미만 아동의 개인정보 처리)">
          <p>
            회사는 만 14세 미만 아동의 개인정보를 수집하지 않는 것을 원칙으로 합니다. 첫 로그인 시 동의
            화면에서 만 14세 이상 여부를 확인하며, 확인하지 않으면 서비스를 이용할 수 없습니다.
          </p>
        </Article>

        <Article title="제11조 (개인정보 보호책임자)">
          <p>
            회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 이용자의 불만처리 및 피해구제 등을
            위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.
          </p>
          <List>
            <li>성명: 김주안</li>
            <li>이메일: 16strata_stardom@icloud.com</li>
          </List>
          <p>
            이용자는 서비스 이용 중 발생한 모든 개인정보 관련 문의, 불만처리, 피해구제 등을 위 이메일로
            연락하실 수 있으며, 회사는 지체 없이 답변 및 처리해드립니다.
          </p>
        </Article>

        <Article title="제12조 (개인정보처리방침의 변경 및 고지)">
          <List ordered>
            <li>
              본 방침은 법령·정책 또는 보안기술의 변경에 따라 내용의 추가·삭제 및 수정이 있을 수
              있습니다.
            </li>
            <li>방침이 변경되는 경우 회사는 변경사항을 앱 내 공지사항을 통해 안내합니다.</li>
          </List>
        </Article>

        <Article title="제13조 (권익침해 구제방법)">
          <p>이용자는 개인정보 침해로 인한 신고나 상담이 필요한 경우 아래 기관에 문의할 수 있습니다.</p>
          <List>
            <li>개인정보보호위원회 (privacy.go.kr / 국번없이 182)</li>
            <li>개인정보침해신고센터 (privacy.kisa.or.kr / 국번없이 118)</li>
            <li>대검찰청 사이버수사과 (spo.go.kr / 국번없이 1301)</li>
            <li>경찰청 사이버수사국 (ecrm.cyber.go.kr / 국번없이 182)</li>
          </List>
        </Article>

        <Article title="부칙">
          <p>본 방침은 2026년 9월 27일부터 시행합니다.</p>
        </Article>
      </article>
    </main>
  );
}
