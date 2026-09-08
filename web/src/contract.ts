/**
 * Контракт сервера в клиенте.
 *
 * Типы не переписываются, а импортируются из `server/src/contract/`: там
 * сказано прямо — «сервер реализует его, клиент импортирует те же типы,
 * расхождение ломает сборку». Импорт идёт на объявления `server/dist`,
 * поэтому в браузер ничего из сервера не попадает: `export type` стирается
 * при компиляции.
 *
 * Следствие для сборки: `web` собирается после `server`.
 */

export type {
  AnswerInput,
  BlockDto,
  BlockSlot,
  CardDto,
  CreateProfileRequest,
  DisagreementKind,
  DisagreementRequest,
  DoorDto,
  ErrorCode,
  ErrorDto,
  GenerationStatus,
  MapBarDto,
  OfferDto,
  PageStateDto,
  PageStateName,
  PublicPageDto,
  PurchaseRequest,
  QuestionDto,
  QuestionKind,
  ShareDto,
  SubmitPortionRequest,
} from "../../server/dist/contract/index.js";
