package http

import (
	"context"
	stdhttp "net/http"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/config"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/toolrunner"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
	sqlitestore "github.com/supermonkeyguys/specship/apps/server-go/internal/store/sqlite"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/transport/http/handlers"
	appsse "github.com/supermonkeyguys/specship/apps/server-go/internal/transport/sse"
)

func NewRouter() stdhttp.Handler {
	cfg := config.Default()

	db, err := sqlitestore.New(cfg.DBDSN)
	if err != nil {
		panic(err)
	}

	broker := appsse.NewInMemoryBroker()
	projects := sqlitestore.NewProjectRepository(db)
	sessions := sqlitestore.NewSessionRepository(db)
	graphs := sqlitestore.NewGraphRepository(db)
	events := sqlitestore.NewEventStore(db, broker)

	staticPlanner := app.NewStaticPlanner()
	var planner appruntime.Planner = staticPlanner
	var llmClient llm.Client
	if cfg.LLMAPIKey != "" {
		llmClient = llm.NewOpenAICompatibleClient(llm.Config{
			BaseURL: cfg.LLMBaseURL,
			APIKey:  cfg.LLMAPIKey,
			Timeout: 60 * time.Second,
		})
	}
	if llmClient != nil && cfg.LLMPlannerModel != "" {
		planner = app.NewLLMPlanner(llmClient, cfg.LLMPlannerModel, staticPlanner)
	}

	clock := appruntime.RealClock{}
	runtimeManager := appruntime.NewManagerWithFactories(events, sessions, graphs, planner, func(input appruntime.StartInput) appruntime.Executor {
		root := app.ResolveExecutionRoot(cfg.WorkspaceDir, input.RepoPath, input.SessionID)
		runner := toolrunner.NewLocalClient(root)
		if llmClient != nil && cfg.LLMExecutorModel != "" {
			return appruntime.NewLLMImplementExecutor(llmClient, runner, cfg.LLMExecutorModel, root)
		}
		return appruntime.NewDeterministicExecutor(runner)
	}, func(input appruntime.StartInput) appruntime.Verifier {
		root := app.ResolveExecutionRoot(cfg.WorkspaceDir, input.RepoPath, input.SessionID)
		runner := toolrunner.NewLocalClient(root)
		return appruntime.NewBasicVerifier(runner, llmClient, cfg.LLMReviewerModel, root)
	}, clock)
	if err := app.RecoverActiveSessions(context.Background(), runtimeManager, projects, sessions, graphs); err != nil {
		panic(err)
	}

	runService := &app.RunService{
		Sessions: sessions,
		Runtime:  runtimeManager,
		Projects: projects,
	}
	resumeService := &app.ResumeService{Runtime: runtimeManager}
	retryService := &app.RetryService{Runtime: runtimeManager}
	checkpointService := &app.CheckpointService{Runtime: runtimeManager}
	projectService := &app.ProjectService{Projects: projects, Sessions: sessions}
	projectMutationService := &app.ProjectMutationService{Projects: projects, Sessions: sessions, Runtime: runtimeManager}
	sessionService := &app.SessionService{Sessions: sessions, Graphs: graphs, Events: events}
	webCompatService := &app.WebCompatService{Projects: projects, Sessions: sessions, Graphs: graphs, Events: events}
	nodeCompatService := &app.NodeCompatService{Projects: projects, Sessions: sessions, Graphs: graphs, Runtime: runtimeManager, WorkspaceDir: cfg.WorkspaceDir, Reviewer: llmClient, ReviewerModel: cfg.LLMReviewerModel}
	chatService := &app.ChatService{Client: llmClient, Model: cfg.LLMPlannerModel}
	clarifyService := &app.ClarifyService{Client: llmClient, Model: cfg.LLMPlannerModel}
	prdService := &app.PRDService{Client: llmClient, Model: cfg.LLMPlannerModel}
	planService := &app.PlanService{Planner: planner}
	fileService := &app.FileService{Projects: projects, Sessions: sessions, Graphs: graphs, WorkspaceDir: cfg.WorkspaceDir}
	previewService := &app.PreviewService{Projects: projects, Sessions: sessions, Graphs: graphs, WorkspaceDir: cfg.WorkspaceDir}

	mux := stdhttp.NewServeMux()
	mux.Handle("/health", handlers.HealthHandler{})
	mux.Handle("/api/status", handlers.WebCompatStatusHandler{Service: webCompatService})
	mux.Handle("/api/resume", handlers.WebCompatResumeHandler{ResumeService: resumeService, StatusService: webCompatService})
	mux.Handle("/api/projects/", handlers.ProjectFileMuxHandler{GraphHandler: handlers.WebCompatGraphHandler{Service: webCompatService}, FileHandler: handlers.FileHandler{Service: fileService}, PreviewHandler: handlers.PreviewHandler{Service: previewService}, ProjectMutationHandler: handlers.ProjectMutationHandler{Service: projectMutationService}})
	mux.Handle("/api/runs", handlers.RunHandler{Service: runService})
	mux.Handle("/api/run", handlers.CompatRunHandler{Service: runService})
	mux.Handle("/api/prd", handlers.CompatPRDHandler{Service: prdService})
	mux.Handle("/api/plan", handlers.PlanHandler{Service: planService})
	mux.Handle("/api/clarify", handlers.CompatClarifyHandler{Service: clarifyService})
	mux.Handle("/api/chat", handlers.CompatChatHandler{Service: chatService})
	mux.Handle("/api/projects", handlers.ProjectHandler{Service: projectService})
	mux.Handle("/api/sessions/", handlers.SessionHandler{Service: sessionService})
	mux.Handle("/api/stream", handlers.StreamHandler{Events: events, Broker: broker, WebCompatService: webCompatService})
	mux.Handle("/api/session/retry", handlers.NodeCompatHandler{Service: nodeCompatService})
	mux.Handle("/api/node/", handlers.NodeCompatHandler{Service: nodeCompatService})
	mux.Handle("/api/runs/", handlers.RunCommandHandler{
		ResumeService:     resumeService,
		RetryService:      retryService,
		CheckpointService: checkpointService,
	})
	return mux
}
