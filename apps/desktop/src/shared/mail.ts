// 메일 주소 규칙 (main과 renderer가 같이 씀)

/** 시연용 주소: .test는 실제로 배달되지 않는 예약 도메인(RFC 2606). 목업 업체(npm run mock)의 메일 주소가 모두 이 형태다 */
export const isDemoAddress = (to: string) => /^[^\s@]+@[^\s@]+\.test$/i.test(to.trim());
