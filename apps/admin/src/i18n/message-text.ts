// Pure catalog-backed lookup for strings authored by admin API helpers.
// Korean is the source language, so it returns stored text byte-for-byte.
import type { Translate } from '@0disoft/saylo-core';

type DynamicArguments = {
  "apiHttpFailure": {
    status: string
  },
  "apiContractDetail": {
    detail: string
  },
  "endpointSameOriginPath": {
    path: string
  },
  "integerRange": {
    maximum: string
  },
  "integerRangeCreate": {
    maximum: string
  },
  "schemaPublishConfirmed": {
    version: string
  },
  "schemaVersionLoadedEditable": {
    version: string
  },
  "schemaVersionLoaded": {
    version: string
  },
  "schemaVersionRetired": {
    version: string
  },
  "schemaVersionPublished": {
    version: string
  },
  "funnelStepLabel": {
    step: string
  },
  "funnelStepReached": {
    step: string
  },
  "funnelStepReachRate": {
    step: string
  },
  "funnelStepConversion": {
    step: string
  },
  "comparisonDimensionRequired": {
    property: string
  }
};
type DynamicMessageKey = keyof DynamicArguments;
type DynamicCatalogKey = `messages:${DynamicMessageKey}`;

export type MessageText = (message: string | null | undefined) => string;

const EXACT_SOURCES = {
  "관리자 인증이 필요해요. (HTTP 401)": "messages:apiErrorUnauthorized",
  "이 프로젝트에 대한 권한이 없어요. (HTTP 403)": "messages:apiErrorForbidden",
  "프로젝트나 스키마를 찾지 못했어요. (HTTP 404)": "messages:apiErrorNotFound",
  "요청 범위가 계약과 맞지 않아요. (HTTP 400)": "messages:apiErrorInvalidRequest",
  "저장소를 사용할 수 없어요. (HTTP 503)": "messages:apiErrorStorageUnavailable",
  "관리 API에 연결하지 못했어요. 잠시 후 다시 시도해 주세요. (HTTP 503)": "messages:apiErrorAdminApiUnavailable",
  "다른 변경 사항이 있어요. 최신 설정을 확인해 주세요. (HTTP 409)": "messages:apiErrorSettingsConflict",
  "발행된 스키마가 바뀌었어요. 최신 버전을 확인해 주세요. (HTTP 409)": "messages:apiErrorSchemaConflict",
  "다른 곳에서 서버 초안을 저장했어요. 최신 초안을 확인해 주세요. (HTTP 409)": "messages:apiErrorSchemaDraftConflict",
  "이미 사용 중이거나 다른 내용으로 생성된 프로젝트 ID예요. (HTTP 409)": "messages:apiErrorProjectConflict",
  "프로젝트 생성 개수 한도에 도달했어요. 운영자에게 한도를 확인해 주세요. (HTTP 409)": "messages:apiErrorProjectLimitReached",
  "계정 권한이 바뀌었어요. 최신 목록을 확인한 뒤 다시 선택해 주세요. (HTTP 409)": "messages:apiErrorGrantConflict",
  "발행 권한이 바뀌었어요. 최신 목록을 확인한 뒤 다시 회수해 주세요. (HTTP 409)": "messages:apiErrorPublisherConflict",
  "마지막 소유자의 권한은 낮추거나 회수할 수 없어요. 다른 소유자를 먼저 추가해 주세요. (HTTP 409)": "messages:apiErrorLastOwner",
  "요청이 실패했어요.": "messages:apiErrorHttp",
  "API 서버에 연결하지 못했어요.": "messages:apiErrorNetwork",
  "요청 대기 시간이 지났어요. 다시 조회해 주세요. 저장 요청이었다면 최신 상태를 먼저 확인해 주세요.": "messages:apiErrorTimeout",
  "API 응답이 계약과 맞지 않아요.": "messages:apiErrorContract",
  "이 프로토타입은 같은 출처(same-origin)에만 연결해요. 다른 출처는 이번 범위가 아니라 연결하지 않아요. 교차 출처 연결에는 HTTPS와 서버 측 명시적 CORS 허용이 필요하고, 로컬 개발에서만 http://localhost 예외를 둘 수 있어요.": "messages:crossOriginNotice",
  "연결 주소 형식을 확인해 주세요.": "messages:endpointFormat",
  "주소에 자격 증명(userinfo)을 넣을 수 없어요.": "messages:endpointCredentials",
  "주소에 쿼리나 해시를 넣을 수 없어요.": "messages:endpointQueryHash",
  "서버 초안 프로젝트가 요청과 달라요.": "messages:draftProjectMismatch",
  "초안 파일 예산 128KiB와 버전 입력 32자 한도를 확인해 주세요.": "messages:draftBudget",
  "서버 초안 저장 결과가 요청과 달라요. 최신 상태를 확인해 주세요.": "messages:draftSaveMismatch",
  "프로젝트 검색어는 제어 문자 없이 80자 이내로 입력해 주세요.": "messages:projectSearchInvalid",
  "통합 현황의 프로젝트나 출처가 요청과 달라요.": "messages:overviewIdentityMismatch",
  "응답이 요청한 프로젝트나 스키마 버전과 맞지 않아요.": "messages:schemaIdentityMismatch",
  "생성 요청은 16KiB 이하여야 해요.": "messages:createRequestTooLarge",
  "생성 응답이 요청한 프로젝트·내용과 달라요.": "messages:createIdentityMismatch",
  "응답 프로젝트가 요청과 달라요.": "messages:responseProjectMismatch",
  "페이지 위치를 확인해 주세요.": "messages:pagePositionInvalid",
  "권한 목록의 프로젝트나 페이지가 요청과 달라요.": "messages:grantsPageMismatch",
  "프로젝트와 페이지 위치를 확인해 주세요.": "messages:projectPageInvalid",
  "변경 이력의 프로젝트나 페이지가 요청과 달라요.": "messages:changesPageMismatch",
  "발행자 목록의 프로젝트나 페이지가 요청과 달라요.": "messages:publishersPageMismatch",
  "발급자·계정 식별자와 발행 권한 상태를 확인해 주세요.": "messages:publisherInputInvalid",
  "프로젝트 ID를 확인해 주세요.": "messages:projectIdInvalid",
  "발행 권한 요청은 16KiB 이하여야 해요.": "messages:publisherRequestTooLarge",
  "발행 권한 응답이 요청한 계정·프로젝트·상태와 달라요.": "messages:publisherResponseMismatch",
  "발급자·계정 식별자와 권한을 확인해 주세요.": "messages:grantInputInvalid",
  "권한 요청은 16KiB 이하여야 해요.": "messages:grantRequestTooLarge",
  "권한 변경 응답이 요청한 계정·프로젝트·역할과 달라요.": "messages:grantResponseMismatch",
  "스키마 목록이 요청과 맞지 않아요.": "messages:schemaListMismatch",
  "정의는 32KiB 이하여야 해요.": "messages:definitionTooLarge",
  "발행 요청이 너무 커요.": "messages:publishRequestTooLarge",
  "발행 응답이 요청한 정의·프로젝트·버전과 맞지 않아요.": "messages:publishResponseMismatch",
  "설정 요청이 너무 커요.": "messages:settingsRequestTooLarge",
  "저장 응답이 요청과 맞지 않아요.": "messages:settingsResponseMismatch",
  "저장 응답에 변경한 값이 반영되지 않았어요.": "messages:settingsValuesMissing",
  "거부 집계의 프로젝트·기간이 요청과 달라요.": "messages:rejectionsIdentityMismatch",
  "응답 이벤트가 요청과 달라요.": "messages:eventResponseMismatch",
  "응답 groupBy가 요청과 달라요.": "messages:groupByResponseMismatch",
  "퍼널 응답의 프로젝트·버전·기간이 요청과 달라요.": "messages:funnelRangeMismatch",
  "등록된 퍼널 분류를 선택해 주세요.": "messages:funnelBreakdownInvalid",
  "퍼널 분류 응답이 요청한 프로젝트·버전·기간·분류와 달라요.": "messages:funnelBreakdownMismatch",
  "응답 작업 흐름이 요청과 달라요.": "messages:workflowResponseMismatch",
  "흐름이나 분류 기준이 요청과 달라요.": "messages:workflowGroupByMismatch",
  "스키마 버전을 1 이상의 정수로 입력해 주세요.": "messages:schemaVersionInvalid",
  "발행 출처를 확인해 주세요.": "messages:eventSourceInvalid",
  "응답이 요청한 프로젝트·버전·기간과 맞지 않아요.": "messages:responseRangeMismatch",
  "API 응답을 JSON으로 읽지 못했어요.": "messages:transportJsonInvalid",
  "요청 대기 시간은 10~120000밀리초의 정수여야 해요.": "messages:transportTimeoutInvalid",
  "수집 상태 응답을 확인할 수 없어요.": "messages:collectionStatusInvalid",
  "수신 시각이 올바른 UTC 시각이 아니에요.": "messages:collectionReceiptUtcInvalid",
  "수신 시각의 날짜가 올바르지 않아요.": "messages:collectionReceiptDateInvalid",
  "수집 상태의 이벤트 정의와 합계가 맞지 않아요.": "messages:collectionCountsMismatch",
  "유효한 스키마 버전을 입력해 주세요.": "messages:collectionSchemaVersionInvalid",
  "CSV 수치가 유효하지 않아요.": "messages:csvInvalidNumber",
  "현재 조회 조건과 CSV 데이터가 맞지 않아요. 다시 조회해 주세요.": "messages:csvQueryMismatch",
  "현재 기간 조회를 마쳐야 CSV를 내려받을 수 있어요.": "messages:csvWaitCurrent",
  "실패한 작업 흐름 조회를 복구해야 전체 CSV를 내려받을 수 있어요.": "messages:csvWorkflowErrors",
  "직전 기간의 실패한 작업 흐름을 다시 조회해 주세요.": "messages:csvPreviousWorkflowErrors",
  "직전 기간이 보존 범위를 벗어나요. 비교를 끄면 현재 기간 CSV를 내려받을 수 있어요.": "messages:csvPreviousOutOfRange",
  "직전 기간 비교를 마치거나 비교를 꺼 주세요.": "messages:csvWaitComparison",
  "선택한 이벤트 상세 조회를 마치거나 상세를 닫아 주세요.": "messages:csvWaitEventDetail",
  "이벤트 속성별 기간 비교를 마치거나 비교·분류를 해제해 주세요.": "messages:csvWaitPropertyComparison",
  "속성별 완료율 조회를 마치거나 해당 분류를 해제해 주세요.": "messages:csvWaitWorkflowDetails",
  "속성별 기간 비교를 마치거나 비교를 꺼 주세요.": "messages:csvWaitWorkflowComparison",
  "등록에 없음": "messages:unregisteredLabel",
  "시작일과 종료일에 올바른 날짜를 입력해 주세요.": "messages:dateRangeInvalid",
  "종료일은 시작일과 같거나 이후여야 해요.": "messages:dateRangeOrder",
  "프로젝트 시간대의 오늘 이후는 조회할 수 없어요.": "messages:dateRangeFuture",
  "데이터는 오늘을 포함한 최근 90일 안에서 조회할 수 있어요.": "messages:dateRangeRetention",
  "한 번에 최대 31일을 조회할 수 있어요. 시작일과 종료일도 포함해요.": "messages:dateRangeMaximum",
  "현재 조회 기간을 먼저 확인해 주세요.": "messages:dateRangeFixFirst",
  "직전 비교 기간이 최근 90일 보존 범위를 벗어나요. 현재 기간은 계속 볼 수 있어요.": "messages:dateComparisonOutOfRange",
  "변경 이력을 읽을 소유자 권한을 확인할 수 없어요. 최신 설정이나 연결을 확인해 주세요.": "messages:changeHistoryDenied",
  "변경 이력을 불러오지 못했어요. 다시 시도해 주세요.": "messages:changeHistoryLoadFailed",
  "관리자 인증과 접근 권한을 확인해 주세요.": "messages:healthAuthRequired",
  "저장소 읽기를 확인하지 못했어요. 서버 연결과 검사 설정을 확인해 주세요.": "messages:healthStorageConfig",
  "이 서버에는 읽기 검사 경로가 없어요. 서버 버전을 확인해 주세요.": "messages:healthRouteMissing",
  "읽기 검사 응답이 예상한 형식과 달라요. 서버 버전을 확인해 주세요.": "messages:healthContract",
  "저장소 읽기를 확인하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.": "messages:healthStorageRetry",
  "응답을 기다리는 시간이 길어졌어요. 연결 상태를 확인하고 다시 시도해 주세요.": "messages:healthTimeout",
  "로그인 계정을 확인하지 못했어요. 다시 시도해 주세요.": "messages:identityLoadFailed",
  "속성별 응답의 값·날짜·합계가 등록 정의와 맞지 않아요.": "messages:eventAnalysisInvalid",
  "등록된 이벤트 속성을 선택해야 기간을 비교할 수 있어요.": "messages:eventComparisonPropertyMissing",
  "이벤트 속성 비교 응답이 현재 분류와 맞지 않아요.": "messages:eventComparisonBreakinvalid",
  "비교할 작업 흐름이 달라요.": "messages:failureComparisonWorkflowMismatch",
  "퍼널 비교의 속성 분류 기준이 맞지 않아요.": "messages:funnelComparisonBreakdownMismatch",
  "퍼널 분류의 정의·자료형·단계·날짜·합계가 맞지 않아요.": "messages:funnelBreakdownContract",
  "퍼널 분류 응답을 확인할 수 없어요.": "messages:funnelBreakdownUnavailable",
  "퍼널 비교의 프로젝트·버전·정의·직전 기간이 현재 조회와 맞지 않아요.": "messages:funnelComparisonRangeMismatch",
  "퍼널 비교의 단계 수가 맞지 않아요.": "messages:funnelComparisonStepCount",
  "시작 실행": "messages:funnelStartedRuns",
  "완료 실행": "messages:funnelCompletedRuns",
  "완료율": "messages:completionRate",
  "퍼널 응답의 정의·기간·단계 건수·비율이 계약과 맞지 않아요.": "messages:funnelContractInvalid",
  "퍼널 CSV의 분류가 현재 프로젝트·기간·정의와 맞지 않아요.": "messages:funnelCsvCurrentMismatch",
  "퍼널 CSV의 직전 분류가 비교 기간과 맞지 않아요.": "messages:funnelCsvPreviousMismatch",
  "등록된 퍼널을 선택해 주세요.": "messages:funnelSelectRequired",
  "퍼널 응답이 등록된 정의와 맞지 않아요.": "messages:funnelReportMismatch",
  "HTTPS 발급자 주소·계정 식별자와 권한을 확인해 주세요.": "messages:grantEditorInputInvalid",
  "권한을 변경할 수 없어요. 최신 설정이나 연결을 확인해 주세요.": "messages:grantEditorDenied",
  "저장 결과를 확인하지 못했어요. 입력은 고정했어요. 같은 요청으로 결과를 다시 확인해 주세요.": "messages:saveResultUncertain",
  "권한 변경을 저장했어요.": "messages:grantSaved",
  "이미 요청한 권한 상태예요. 결과를 확인했어요.": "messages:grantAlreadyRequested",
  "권한 목록을 조회하려면 현재 프로젝트 소유자 권한이 필요해요. 연결이나 최신 설정을 확인해 주세요.": "messages:grantListDenied",
  "권한 목록을 불러오지 못했어요. 다시 시도해 주세요.": "messages:grantListLoadFailed",
  "스키마 목록의 프로젝트·버전 순서가 맞지 않아요.": "messages:schemaOrderMismatch",
  "스키마 목록의 순회 위치가 진행하지 않아요.": "messages:schemaCursorStalled",
  "알 수 없는 오류가 발생했어요.": "messages:unknownError",
  "보고서 파일은 8MiB 이하로 선택해 주세요.": "messages:observationTooLarge",
  "logs:summary가 만든 v2 JSON 보고서를 선택해 주세요. 파일 형식이나 집계 합계를 확인할 수 없어요.": "messages:observationFormatInvalid",
  "보고서를 읽지 못했어요. 파일을 다시 선택해 주세요.": "messages:observationReadFailed",
  "보고서를 읽는 시간이 길어졌어요. 파일을 다시 선택해 주세요.": "messages:observationReadTimeout",
  "보고서를 읽지 못했어요. 이 브라우저의 파일 처리 지원을 확인해 주세요.": "messages:observationBrowserUnsupported",
  "표본 정보 없음": "messages:overviewNoSample",
  "비교할 시작 기록 없음": "messages:overviewNoStarts",
  "집계 중 · 비교 보류": "messages:overviewAggregating",
  "표본 적음 · 비교 보류": "messages:overviewSmallSample",
  "수집 이벤트": "messages:periodCollectedEvents",
  "시작": "messages:periodStarted",
  "성공": "messages:periodSucceeded",
  "기간 비교 응답의 날짜·정의·합계가 요청과 맞지 않아요.": "messages:periodComparisonContract",
  "영문 소문자로 시작하는 1~48자의 소문자·숫자·하이픈을 입력해 주세요.": "messages:projectIdFormat",
  "프로젝트 이름을 1~80자로 입력해 주세요.": "messages:projectNameInvalid",
  "Asia/Seoul, UTC처럼 유효한 IANA 시간대를 입력해 주세요.": "messages:projectTimeZoneInvalid",
  "출처를 중복 없이 최대 16개 입력해 주세요.": "messages:projectOriginsDuplicate",
  "https://example.com처럼 경로 없이 정확한 출처를 입력해 주세요.": "messages:projectOriginInvalid",
  "전체 생성 요청은 16KiB 이하여야 해요.": "messages:projectCreateTooLarge",
  "입력한 내용을 확인해 주세요.": "messages:projectCreatorInputInvalid",
  "프로젝트 생성을 확인했어요. 첫 스키마를 등록해 주세요.": "messages:projectCreated",
  "프로젝트 owner와 별개로 생성 권한이 필요해요. 운영자에게 생성 권한을 확인해 주세요.": "messages:projectCreatePermission",
  "이미 사용 중이거나 다른 내용으로 생성된 ID예요. 다른 ID를 입력해 주세요.": "messages:projectIdConflict",
  "생성 결과를 확인하지 못했어요. 입력은 보존했어요. 같은 요청으로 생성 여부를 확인해 주세요.": "messages:projectCreateUncertain",
  "생성한 프로젝트 화면을 열지 못했어요. 생성한 프로젝트 열기를 다시 눌러 주세요.": "messages:projectOpenFailed",
  "프로젝트 생성은 완료됐어요. 화면 이동은 취소했어요. 준비되면 생성한 프로젝트 열기를 눌러 주세요.": "messages:projectNavigationCancelled",
  "생성은 확인했지만 프로젝트 설정을 불러오지 못했어요. 생성 요청을 다시 보내지 않고 설정만 조회해요.": "messages:projectSettingsAfterCreateFailed",
  "통합 현황의 시간대가 프로젝트와 달라요.": "messages:projectOverviewTimeZoneMismatch",
  "프로젝트 검색 페이지가 앞으로 진행하지 않아요.": "messages:projectSearchCursorStalled",
  "프로젝트를 검색하지 못했어요. 다시 시도해 주세요.": "messages:projectSearchFailed",
  "HTTPS 발급자 주소와 계정 식별자를 확인해 주세요.": "messages:publisherEditorInputInvalid",
  "발행 권한을 변경할 수 없어요. 최신 설정이나 연결을 확인해 주세요.": "messages:publisherEditorDenied",
  "서버 발행 권한을 저장했어요.": "messages:publisherGranted",
  "이미 발행 권한이 있는 계정이에요. 결과를 확인했어요.": "messages:publisherAlreadyGranted",
  "서버 발행 권한을 회수했어요.": "messages:publisherRevoked",
  "이미 발행 권한이 없는 계정이에요. 결과를 확인했어요.": "messages:publisherAlreadyRevoked",
  "서버 발행자 목록을 조회하려면 현재 프로젝트 소유자 권한이 필요해요. 연결이나 최신 설정을 확인해 주세요.": "messages:publisherListDenied",
  "서버 발행자 목록을 불러오지 못했어요. 다시 시도해 주세요.": "messages:publisherListLoadFailed",
  "초안 파일은 128KiB 이하로 선택해 주세요.": "messages:draftFileTooLargeSelect",
  "파일 읽기 제한 시간을 확인해 주세요.": "messages:draftFileTimeoutInvalid",
  "초안 파일은 128KiB 이하의 UTF-8 파일이어야 해요.": "messages:draftFileTooLarge",
  "초안 파일을 UTF-8로 읽지 못했어요. UTF-8로 저장한 파일을 선택해 주세요.": "messages:draftFileEncoding",
  "초안 파일을 읽지 못했어요. 다시 선택해 주세요.": "messages:draftFileReadFailed",
  "초안 파일 읽기가 중단됐어요. 다시 선택해 주세요.": "messages:draftFileReadInterrupted",
  "파일 읽기 시간이 길어졌어요. 다시 선택해 주세요.": "messages:fileReadTimeout",
  "초안 파일은 128KiB 이하여야 해요.": "messages:draftFileBudget",
  "Tallyfin에서 저장한 초안 JSON 파일을 선택해 주세요.": "messages:draftFileJsonInvalid",
  "초안 파일 형식을 확인해 주세요.": "messages:draftFileShapeInvalid",
  "지원하는 Tallyfin 초안 파일 형식이 아니에요.": "messages:draftFileUnsupported",
  "현재 프로젝트에서 저장한 초안 파일을 선택해 주세요.": "messages:draftFileProjectMismatch",
  "분당 요청 한도": "messages:rejectionMinuteLimit",
  "일일 신규 수신 한도": "messages:rejectionDailyLimit",
  "허용 출처 불일치": "messages:rejectionOriginDenied",
  "프로젝트 일시정지": "messages:rejectionProjectUnavailable",
  "사용할 수 없는 스키마": "messages:rejectionUnknownSchema",
  "요청 형식 오류": "messages:rejectionInvalidRequest",
  "이벤트 형식 오류": "messages:rejectionInvalidEvent",
  "이벤트 ID 충돌": "messages:rejectionEventConflict",
  "작업 시도 충돌": "messages:rejectionAttemptConflict",
  "저장소 오류": "messages:rejectionStorageUnavailable",
  "서버 초안 응답 형식이 달라요.": "messages:savedDraftResponseShape",
  "서버 초안 revision이 올바르지 않아요.": "messages:savedDraftRevisionInvalid",
  "서버 초안 프로젝트가 올바르지 않아요.": "messages:savedDraftProjectInvalid",
  "서버 초안 메타데이터가 올바르지 않아요.": "messages:savedDraftMetadataInvalid",
  "서버 초안이 허용 크기나 형식과 달라요.": "messages:savedDraftSizeInvalid",
  "서버 초안을 읽지 못했어요. 다시 확인해 주세요.": "messages:savedDraftLoadFailed",
  "저장 결과를 확인하지 못했어요. 서버 초안을 다시 확인해 주세요.": "messages:savedDraftSaveUncertain",
  "비교할 서로 다른 두 버전을 골라 주세요.": "messages:schemaComparisonVersionsRequired",
  "비교 응답의 프로젝트나 버전이 요청과 달라요.": "messages:schemaComparisonIdentityMismatch",
  "로그인을 완료하지 못했어요. 제공자 설정을 확인한 뒤 다시 로그인해 주세요.": "messages:authProviderFailed",
  "관리자 로그인 설정을 확인해 주세요.": "messages:authConfigInvalid",
  "openid를 포함한 로그인 scope가 필요해요.": "messages:authScopeInvalid",
  "관리자 로그인은 HTTPS 또는 로컬 개발 주소에서만 사용할 수 있어요.": "messages:authHttpsRequired",
  "로그인 resource 설정을 확인해 주세요.": "messages:authResourceInvalid",
  "지원하지 않는 ID token 서명 알고리즘이에요.": "messages:authAlgorithmUnsupported",
  "비밀번호 변경 주소의 로그인 제공자를 확인해 주세요.": "messages:authPasswordProviderMismatch",
  "로그인 제공자의 HTTPS 주소를 확인해 주세요.": "messages:authIssuerHttps",
  "요청을 완료하지 못했어요. 다시 확인해 주세요.": "messages:schemaRequestFailed",
  "최신 버전보다 큰 번호와 events·workflows 배열이 있는 JSON을 입력해 주세요. 정의는 32KiB 이하여야 해요.": "messages:schemaDraftJsonInvalid",
  "최신 서버 정의와 내 초안을 비교한 뒤 사용할 내용을 골라 주세요.": "messages:schemaCompareLatest",
  "서버 초안을 불러왔어요. 버전과 정의를 검증하고 개인정보 검토를 다시 확인해 주세요.": "messages:schemaServerDraftLoaded",
  "초안 파일을 불러왔어요. 버전과 정의를 검증하고 개인정보 검토를 다시 확인해 주세요.": "messages:schemaFileDraftLoaded",
  "작성 중인 초안이 있어요. 버전을 불러오려면 초안 교체를 확인해 주세요.": "messages:schemaDraftReplacementRequired",
  "정의 검증을 통과했어요. 개인정보 검토를 확인한 뒤 발행해 주세요.": "messages:schemaValidationPassed",
  "정의 오류를 수정한 뒤 다시 검증해 주세요.": "messages:schemaValidationFailed",
  "편집 권한을 확인할 수 없어요. 초안은 보존했어요. 서버 상태를 확인한 뒤 다시 검토해 주세요.": "messages:schemaEditDenied",
  "발행 권한을 확인할 수 없어요. 초안은 보존했어요. 서버 상태를 확인한 뒤 다시 검토해 주세요.": "messages:schemaPublishDenied",
  "발행 결과를 확인하지 못했어요. 초안은 보존했어요. 서버 상태를 확인한 뒤 다시 검토해 주세요.": "messages:schemaPublishUncertain",
  "서버의 최신 정의를 사용해요.": "messages:schemaUseServer",
  "초안을 유지했어요. 새 버전 번호와 정의를 다시 검증한 뒤 발행해 주세요.": "messages:schemaDraftKept",
  "폼으로 편집할 수 없는 정의예요. JSON 직접 편집에서 이벤트 형식을 확인해 주세요.": "messages:eventFormJsonOnly",
  "이벤트는 최대 50개까지 등록할 수 있어요.": "messages:eventLimit",
  "편집할 이벤트를 확인해 주세요.": "messages:eventEditTargetInvalid",
  "작업 흐름·퍼널에 연결된 이벤트의 이름·출처·삭제는 JSON에서 연결 정의와 함께 수정해 주세요.": "messages:eventLinkedFieldsJsonOnly",
  "폼으로 편집할 수 없는 퍼널이에요. JSON에서 정의를 확인해 주세요.": "messages:funnelFormJsonOnly",
  "퍼널은 최대 10개까지 등록할 수 있어요.": "messages:funnelLimit",
  "편집할 퍼널을 확인해 주세요.": "messages:funnelEditTargetInvalid",
  "이미 사용 중인 퍼널 ID예요. 다른 퍼널을 덮어쓰지 않았어요.": "messages:funnelIdInUse",
  "비교 기준은 올바른 속성 이름으로 최대 4개까지 중복 없이 선택하세요.": "messages:comparisonDimensionsInvalid",
  "퍼널 단계는 최대 10개까지 등록할 수 있어요.": "messages:funnelStepLimit",
  "편집할 단계를 확인해 주세요.": "messages:funnelStepEditTargetInvalid",
  "퍼널에는 최소 2개 단계가 필요해요.": "messages:funnelStepMinimum",
  "단계를 이동할 위치를 확인해 주세요.": "messages:funnelStepMoveInvalid",
  "등록된 이벤트와 발행 출처를 선택하세요.": "messages:funnelStepSelectRequired",
  "최소 2개 단계를 추가하세요.": "messages:funnelStepAddMinimum",
  "같은 퍼널에서는 이벤트를 한 단계에만 연결하세요.": "messages:funnelEventAlreadyLinked",
  "이벤트와 속성 개수를 확인해 주세요.": "messages:propertyCountInvalid",
  "폼으로 편집할 수 없는 속성이에요. JSON에서 정의를 확인해 주세요.": "messages:propertyFormJsonOnly",
  "속성은 이벤트마다 최대 4개까지 등록할 수 있어요.": "messages:propertyLimit",
  "편집할 속성을 확인해 주세요.": "messages:propertyEditTargetInvalid",
  "작업 흐름·퍼널의 비교 기준 속성이에요. JSON에서 연결된 정의와 함께 수정해 주세요.": "messages:propertyLinkedJsonOnly",
  "이미 사용 중인 속성 이름이에요. 다른 속성을 덮어쓰지 않았어요.": "messages:propertyNameInUse",
  "자료형을 확인해 주세요.": "messages:propertyTypeInvalid",
  "선택값 속성이 아니에요.": "messages:propertyNotEnum",
  "정수 속성이 아니에요.": "messages:propertyNotInteger",
  "대표 흐름 ID는 JSON에서 문자열로 지정하거나 필드를 지워 주세요.": "messages:workflowRepresentativeJsonOnly",
  "폼으로 편집할 수 없는 작업 흐름이에요. JSON에서 정의를 확인해 주세요.": "messages:workflowFormJsonOnly",
  "이 초안에 등록된 작업 흐름을 선택해 주세요.": "messages:workflowSelectRequired",
  "작업 흐름은 최대 10개까지 등록할 수 있어요.": "messages:workflowLimit",
  "편집할 작업 흐름을 확인해 주세요.": "messages:workflowEditTargetInvalid",
  "실패 이벤트의 enum 속성을 선택하세요.": "messages:workflowFailureEnumRequired",
  "실패 이벤트만 없음으로 설정할 수 있어요.": "messages:workflowFailureOnlyNullable",
  "이미 사용 중인 작업 흐름 ID예요. 다른 흐름을 덮어쓰지 않았어요.": "messages:workflowIdInUse",
  "등록된 브라우저 이벤트를 선택하세요.": "messages:workflowBrowserEventRequired",
  "이 이벤트가 다른 단계나 작업 흐름에도 연결되어 있어요. 한 단계에만 연결하세요.": "messages:workflowEventAlreadyLinked",
  "실패 이벤트의 enum 속성을 다시 선택하거나 원인 집계를 해제하세요.": "messages:workflowFailureEnumReselect",
  "수집 서버의 출처만 입력해 주세요. HTTPS 또는 로컬 개발 주소를 사용하세요.": "messages:sdkOriginInvalid",
  "사용 중인 프로젝트와 스키마만 연결할 수 있어요.": "messages:sdkProjectInactive",
  "SDK 발행 출처를 확인해 주세요.": "messages:sdkSourceInvalid",
  "SDK 종류를 확인해 주세요.": "messages:sdkProfileInvalid",
  "이 출처가 참여하는 등록 퍼널이 없어요.": "messages:sdkNoFunnels",
  "선택한 퍼널과 SDK 출처를 확인해 주세요.": "messages:sdkFunnelInvalid",
  "등록된 브라우저 이벤트가 없어요.": "messages:sdkNoBrowserEvents",
  "등록된 서버 이벤트가 없어요.": "messages:sdkNoServerEvents",
  "브라우저 허용 출처가 비어 있어요. 프로젝트 설정에서 서비스 출처를 추가하세요.": "messages:sdkOriginsEmpty",
  "흐름 속성별 응답의 값·날짜·합계가 정의와 맞지 않아요.": "messages:workflowAnalysisInvalid",
  "참 (true)": "messages:booleanTrue",
  "거짓 (false)": "messages:booleanFalse",
  "1초 미만": "messages:durationUnder1s",
  "1초 이상 ~ 5초 미만": "messages:duration1sTo5s",
  "5초 이상 ~ 30초 미만": "messages:duration5sTo30s",
  "30초 이상 ~ 2분 미만": "messages:duration30sTo2m",
  "2분 이상 ~ 10분 미만": "messages:duration2mTo10m",
  "10분 이상 ~ 24시간 이하": "messages:duration10mTo24h",
  "소요시간 분포의 구간·건수·측정 범위가 맞지 않아요.": "messages:workflowDurationInvalid",
  "실패 원인의 정의·건수·측정 범위가 맞지 않아요.": "messages:failureReasonsInvalid",
  "허용 출처를 중복 없이 최대 16개 입력해 주세요.": "messages:settingsOriginsDuplicate",
  "최신 설정을 가져왔어요. 입력한 값과 비교한 뒤 사용할 설정을 골라 주세요.": "messages:settingsLatestLoaded",
  "설정을 불러오지 못했어요. 다시 시도해 주세요.": "messages:settingsLoadFailed",
  "입력한 값을 확인해 주세요.": "messages:settingsInputInvalid",
  "변경한 설정이 없어요.": "messages:settingsNoChanges",
  "프로젝트 설정을 저장했어요.": "messages:settingsSaved",
  "편집 권한을 확인할 수 없어요. 입력한 값은 보존했어요. 다시 연결하거나 최신 설정을 확인해 주세요.": "messages:settingsEditDenied",
  "다른 사람이 설정을 변경했어요. 입력한 값은 보존했어요. 최신 설정을 확인해 주세요.": "messages:settingsConflict",
  "서버가 설정을 거부했어요. 입력값과 허용 출처를 확인해 주세요.": "messages:settingsRejected",
  "저장 결과를 확인하지 못했어요. 입력한 값은 보존했어요. 최신 설정을 확인한 뒤 다시 저장해 주세요.": "messages:settingsSaveUncertain",
  "서버의 최신 설정을 사용해요.": "messages:settingsUseServer",
  "최신 설정에 내 변경을 적용했어요. 값을 검토한 뒤 저장해 주세요.": "messages:settingsApplied"
} as const;
type ExactCatalogKey = (typeof EXACT_SOURCES)[keyof typeof EXACT_SOURCES];
export type MessageTextKey = ExactCatalogKey | DynamicCatalogKey;
export type MessageTextSchema = { [K in ExactCatalogKey]: {} } & { [K in DynamicMessageKey as `messages:${K}`]: DynamicArguments[K] };
export type MessageTextTranslator = Translate<MessageTextSchema>;

type ForwardTranslator = (key: MessageTextKey, args?: Readonly<Record<string, string>>) => string;
type TemplateDefinition = { readonly key: DynamicCatalogKey; readonly template: string; readonly variables: Readonly<Record<string, string>> };
type CompiledTemplate = { readonly key: DynamicCatalogKey; readonly names: readonly string[]; readonly expression: RegExp };

// {{name}} marks a dynamic value. Every other character, including braces, is literal.
const DYNAMIC_TEMPLATES = [
  {
    "key": "messages:apiHttpFailure",
    "template": "요청이 실패했어요. (HTTP {{status}})",
    "variables": {
      "status": "\\d+"
    }
  },
  {
    "key": "messages:apiContractDetail",
    "template": "API 응답이 계약 형식과 달라요. ({{detail}})",
    "variables": {
      "detail": "[\\s\\S]+"
    }
  },
  {
    "key": "messages:endpointSameOriginPath",
    "template": "같은 출처의 {{path}} 경로만 사용할 수 있어요.",
    "variables": {
      "path": "/[^\\s]*"
    }
  },
  {
    "key": "messages:integerRange",
    "template": "1~{{maximum}} 사이의 정수를 입력해 주세요.",
    "variables": {
      "maximum": "[\\d,]+"
    }
  },
  {
    "key": "messages:integerRangeCreate",
    "template": "1~{{maximum}} 사이 정수를 입력해 주세요.",
    "variables": {
      "maximum": "[\\d,]+"
    }
  },
  {
    "key": "messages:schemaPublishConfirmed",
    "template": "v{{version}} 발행을 서버에서 확인했어요. 입력한 정의는 그대로 뒀어요.",
    "variables": {
      "version": "\\d+"
    }
  },
  {
    "key": "messages:schemaVersionLoadedEditable",
    "template": "v{{version}} 정의를 불러왔어요. 변경 후 새 버전으로 발행할 수 있어요.",
    "variables": {
      "version": "\\d+"
    }
  },
  {
    "key": "messages:schemaVersionLoaded",
    "template": "v{{version}} 정의를 불러왔어요.",
    "variables": {
      "version": "\\d+"
    }
  },
  {
    "key": "messages:schemaVersionRetired",
    "template": "v{{version}}은 이미 발행된 사용 중지 버전이에요. 활성 상태로 바꾸지 않았어요.",
    "variables": {
      "version": "\\d+"
    }
  },
  {
    "key": "messages:schemaVersionPublished",
    "template": "v{{version}} 발행을 완료했어요. 제품 SDK의 사용 버전은 별도로 전환해 주세요.",
    "variables": {
      "version": "\\d+"
    }
  },
  {
    "key": "messages:funnelStepLabel",
    "template": "{{step}}단계",
    "variables": {
      "step": "\\d+"
    }
  },
  {
    "key": "messages:funnelStepReached",
    "template": "{{step}}단계 도달",
    "variables": {
      "step": "\\d+"
    }
  },
  {
    "key": "messages:funnelStepReachRate",
    "template": "{{step}}단계 첫 단계 대비 도달률",
    "variables": {
      "step": "\\d+"
    }
  },
  {
    "key": "messages:funnelStepConversion",
    "template": "{{step}}단계 직전 단계 대비 전환율",
    "variables": {
      "step": "\\d+"
    }
  },
  {
    "key": "messages:comparisonDimensionRequired",
    "template": "{{property}}: 모든 단계에 같은 자료형과 허용 값을 가진 필수 속성이 필요해요.",
    "variables": {
      "property": "[A-Za-z_][A-Za-z0-9_]*"
    }
  }
] as const satisfies readonly TemplateDefinition[];
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;
const REGEXP_SPECIAL = new Set('\\^$.*+?()[]{}|');
const EXACT_MESSAGES = new Map<string, ExactCatalogKey>(Object.entries(EXACT_SOURCES));

function escapeRegExp(value: string): string {
  let escaped = '';
  for (const character of value) escaped += REGEXP_SPECIAL.has(character) ? '\\' + character : character;
  return escaped;
}

function compileTemplate(definition: TemplateDefinition): CompiledTemplate {
  const names: string[] = [];
  let cursor = 0;
  let source = '';
  for (const match of definition.template.matchAll(PLACEHOLDER)) {
    source += escapeRegExp(definition.template.slice(cursor, match.index));
    const name = match[1], pattern = definition.variables[name];
    if (!pattern) throw new Error('Missing pattern for ' + definition.key + '.' + name);
    names.push(name);
    source += '(' + pattern + ')';
    cursor = match.index + match[0].length;
  }
  source += escapeRegExp(definition.template.slice(cursor));
  return { key: definition.key, names, expression: new RegExp('^' + source + '$', 'u') };
}

const COMPILED_TEMPLATES = DYNAMIC_TEMPLATES.map(compileTemplate);

export function createMessageText(translate: MessageTextTranslator, locale: string): MessageText {
  const t = translate as unknown as ForwardTranslator;
  const sourceLocale = locale.toLowerCase().startsWith('ko');
  return (message) => {
    if (message === null || message === undefined || message === '') return '';
    if (sourceLocale) return message;
    const exact = EXACT_MESSAGES.get(message);
    if (exact) return t(exact, {});
    for (const compiled of COMPILED_TEMPLATES) {
      const match = compiled.expression.exec(message);
      if (!match) continue;
      const args: Record<string, string> = {};
      for (let index = 0; index < compiled.names.length; index++) args[compiled.names[index]] = match[index + 1];
      return t(compiled.key, args);
    }
    return message;
  };
}

export function translateMessageText(message: string | null | undefined, translate: MessageTextTranslator, locale: string): string {
  return createMessageText(translate, locale)(message);
}
