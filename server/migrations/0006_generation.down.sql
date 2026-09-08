-- Откат 0006: очередь генерации, журнал вызовов и кэш.

DROP TABLE generation_cache;
DROP INDEX generation_calls_profile_idx;
DROP TABLE generation_calls;
DROP INDEX generation_jobs_slot_idx;
DROP INDEX generation_jobs_due_idx;
DROP INDEX generation_jobs_request_idx;
DROP INDEX generation_jobs_active_slot_idx;
DROP TABLE generation_jobs;
