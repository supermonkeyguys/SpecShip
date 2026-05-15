package sqlite

import (
    "context"
    "database/sql"
    "time"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
    appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
    appsse "github.com/supermonkeyguys/specship/apps/server-go/internal/transport/sse"
)

type EventStore struct {
    db     *sql.DB
    broker appsse.Broker
}

func NewEventStore(db *DB, broker appsse.Broker) *EventStore {
    return &EventStore{db: db.SQL, broker: broker}
}

func (s *EventStore) Append(ctx context.Context, sessionID string, expectedRevision int64, events []appruntime.EventRecord) error {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer func() { _ = tx.Rollback() }()

    current, err := latestRevisionTx(ctx, tx, sessionID)
    if err != nil {
        return err
    }
    if current != expectedRevision {
        return domain.ErrRevisionConflict
    }

    next := current
    published := make([]appsse.Event, 0, len(events))
    for _, evt := range events {
        next++
        createdAt := time.Unix(0, evt.CreatedAt).UTC()
        if evt.CreatedAt == 0 {
            createdAt = time.Now().UTC()
        }
        if _, err := tx.ExecContext(ctx, `
            INSERT INTO events (id, session_id, revision, type, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
            evt.ID,
            sessionID,
            next,
            evt.Type,
            string(evt.Payload),
            createdAt.Format(time.RFC3339Nano),
        ); err != nil {
            return err
        }
        published = append(published, appsse.Event{
            SessionID: sessionID,
            Revision:  next,
            Type:      evt.Type,
            Data:      evt.Payload,
        })
    }

    if err := tx.Commit(); err != nil {
        return err
    }

    if s.broker != nil {
        for _, evt := range published {
            _ = s.broker.Publish(ctx, evt)
        }
    }
    return nil
}

func (s *EventStore) List(ctx context.Context, sessionID string, afterRevision int64) ([]domain.Event, error) {
    rows, err := s.db.QueryContext(ctx, `
        SELECT id, session_id, revision, type, payload, created_at
        FROM events
        WHERE session_id = ? AND revision > ?
        ORDER BY revision ASC
    `, sessionID, afterRevision)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    out := make([]domain.Event, 0)
    for rows.Next() {
        evt, err := scanEvent(rows)
        if err != nil {
            return nil, err
        }
        out = append(out, evt)
    }
    return out, rows.Err()
}

func (s *EventStore) LatestRevision(ctx context.Context, sessionID string) (int64, error) {
    return latestRevisionDB(ctx, s.db, sessionID)
}

func latestRevisionDB(ctx context.Context, db *sql.DB, sessionID string) (int64, error) {
    row := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision), 0) FROM events WHERE session_id = ?`, sessionID)
    var rev int64
    if err := row.Scan(&rev); err != nil {
        return 0, err
    }
    return rev, nil
}

func latestRevisionTx(ctx context.Context, tx *sql.Tx, sessionID string) (int64, error) {
    row := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision), 0) FROM events WHERE session_id = ?`, sessionID)
    var rev int64
    if err := row.Scan(&rev); err != nil {
        return 0, err
    }
    return rev, nil
}

func scanEvent(s scanner) (domain.Event, error) {
    var evt domain.Event
    var payload string
    var createdAt string
    if err := s.Scan(&evt.ID, &evt.SessionID, &evt.Revision, &evt.Type, &payload, &createdAt); err != nil {
        return domain.Event{}, err
    }
    t, err := time.Parse(time.RFC3339Nano, createdAt)
    if err != nil {
        return domain.Event{}, err
    }
    evt.Payload = []byte(payload)
    evt.CreatedAt = t
    return evt, nil
}
