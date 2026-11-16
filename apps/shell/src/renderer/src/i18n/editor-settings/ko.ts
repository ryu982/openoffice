import type { zh } from './zh'

export const ko = {
  sectionDesc:
    '끈 편집기는 새 문서 목록에서 빠지고, 그 형식의 파일을 열 때 켤지 묻습니다. 열려 있는 문서는 닫히지 않습니다.',
  aiOffKeeps:
    'AI를 꺼도 로그인·키·스킬·설정은 지워지지 않고, 다시 켜면 그대로 돌아옵니다. 터미널 명령어와 MCP는 AI를 꺼도 그대로 동작합니다.',
  aiOffAsk: '돌고 있는 AI 작업 {count}개를 멈추고 끌까요?',
  aiOffStop: '멈추고 끄기',
  aiOffCancel: '취소',
  saveFailed: '바꾸지 못했습니다. 다시 해 보세요.',
} satisfies Record<keyof typeof zh, string>
