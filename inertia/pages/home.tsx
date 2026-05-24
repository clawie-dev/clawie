export default function Home() {
  return (
    <>
      <div className="hero">
        <h1>Clawie</h1>
        <p>
          The autonomous software agency framework. This instance is running. Sign in
          to reach the operator dashboard, or use the REST API and the <code>node ace</code>
          CLI to drive tasks, approvals, and team state.
        </p>
      </div>

      <div className="cards">
        <a href="/dashboard">
          <h3>Dashboard &nbsp;›</h3>
          <p>Tasks, approvals, audit log, egress, agent modifications</p>
        </a>

        <a href="https://github.com/clawie-dev/docs" target="_blank" rel="noopener noreferrer">
          <h3>Documentation &nbsp;›</h3>
          <p>Concepts, install, REST API reference, CLI reference</p>
        </a>

        <a href="https://github.com/clawie-dev/clawie" target="_blank" rel="noopener noreferrer">
          <h3>Source &nbsp;›</h3>
          <p>The framework on GitHub — MIT, self-hosted forever</p>
        </a>
      </div>
    </>
  )
}
