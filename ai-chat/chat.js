(function () {
  const root = document.getElementById("rag-app");
  if (!root) return;

  const DEFAULT_API_BASE = root.dataset.defaultApiBase || "";
  const API_BASE_KEY = "rag_api_base";

  const state = {
    apiBase: localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE,
    conversations: [],
    activeConversationId: null,
    loading: false,
  };

  const els = {
    apiBaseInput: document.getElementById("api-base-input"),
    apiStatus: document.getElementById("api-status"),
    saveApiBase: document.getElementById("save-api-base"),
    conversationList: document.getElementById("conversation-list"),
    conversationTitle: document.getElementById("conversation-title"),
    newConversation: document.getElementById("new-conversation"),
    deleteConversation: document.getElementById("delete-conversation"),
    uploadInput: document.getElementById("upload-input"),
    uploadButton: document.getElementById("upload-button"),
    uploadStatus: document.getElementById("upload-status"),
    messageList: document.getElementById("message-list"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    sendButton: document.getElementById("send-button"),
  };

  function normalizeApiBase(value) {
    return value.replace(/\/+$/, "");
  }

  function setStatus(text, isError) {
    els.apiStatus.textContent = text;
    els.apiStatus.style.color = isError ? "#b91c1c" : "#475569";
  }

  function setUploadStatus(text, isError) {
    els.uploadStatus.textContent = text;
    els.uploadStatus.style.color = isError ? "#b91c1c" : "#475569";
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function messageToHtml(text) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function previewText(text) {
    return text.length > 300 ? text.slice(0, 300) + "..." : text;
  }

  async function request(path, options) {
    if (!state.apiBase) {
      throw new Error("请先填写 FastAPI 后端地址");
    }

    const response = await fetch(`${state.apiBase}${path}`, options);
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = await response.json();
        detail = data.detail || detail;
      } catch (err) {
        void err;
      }
      throw new Error(detail);
    }
    return response;
  }

  async function requestJson(path, options) {
    const response = await request(path, options);
    return response.json();
  }

  function getActiveConversation() {
    return state.conversations.find(
      (conversation) => conversation.id === state.activeConversationId
    );
  }

  function renderConversationList() {
    els.conversationList.innerHTML = "";

    state.conversations.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `conversation-item${
        conversation.id === state.activeConversationId ? " is-active" : ""
      }`;
      button.innerHTML = `
        <span class="conversation-title">${escapeHtml(conversation.title || "新对话")}</span>
        <span class="conversation-meta">${conversation.message_count || conversation.messages?.length || 0} 条消息</span>
      `;
      button.addEventListener("click", () => switchConversation(conversation.id));
      els.conversationList.appendChild(button);
    });
  }

  function renderMessages() {
    const conversation = getActiveConversation();
    els.messageList.innerHTML = "";

    if (!conversation) {
      els.conversationTitle.textContent = "AI问答";
      return;
    }

    els.conversationTitle.textContent = conversation.title || "新对话";

    conversation.messages.forEach((message) => {
      const article = document.createElement("article");
      article.className = `message ${message.role}`;
      article.innerHTML = `
        <div class="message-role">${message.role === "user" ? "你" : "AI 助手"}</div>
        <div class="message-content">${messageToHtml(message.content || "")}</div>
      `;

      if (Array.isArray(message.sources) && message.sources.length > 0) {
        article.appendChild(createSourcePanel(message.sources));
      }

      els.messageList.appendChild(article);
    });

    els.messageList.scrollTop = els.messageList.scrollHeight;
  }

  function createSourcePanel(sources) {
    const wrapper = document.createElement("details");
    wrapper.className = "source-panel";
    wrapper.open = true;
    wrapper.innerHTML = `<summary>Source Nodes</summary>`;

    sources.forEach((source, index) => {
      const item = document.createElement("div");
      item.className = "source-item";
      item.innerHTML = `
        <div class="source-title">${escapeHtml(
          `${source.index || index + 1}. ${source.source || "unknown"}`
        )}</div>
        <div class="source-preview">${messageToHtml(previewText(source.content || ""))}</div>
      `;
      wrapper.appendChild(item);
    });

    return wrapper;
  }

  function appendLocalMessage(message) {
    const conversation = getActiveConversation();
    if (!conversation) return;
    conversation.messages.push(message);
    renderMessages();
  }

  async function loadConversations() {
    const data = await requestJson("/api/conversations");
    state.conversations = data.items || [];
    if (!state.activeConversationId && state.conversations.length > 0) {
      state.activeConversationId = state.conversations[0].id;
    }
    renderConversationList();
  }

  async function loadConversation(conversationId) {
    const data = await requestJson(`/api/conversations/${conversationId}`);
    const index = state.conversations.findIndex((item) => item.id === conversationId);
    if (index >= 0) {
      state.conversations[index] = { ...state.conversations[index], ...data };
    } else {
      state.conversations.unshift(data);
    }
    state.activeConversationId = conversationId;
    renderConversationList();
    renderMessages();
  }

  async function createConversation() {
    const data = await requestJson("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新对话" }),
    });
    await loadConversations();
    await loadConversation(data.id);
  }

  async function switchConversation(conversationId) {
    if (state.loading || conversationId === state.activeConversationId) return;
    await loadConversation(conversationId);
  }

  async function deleteCurrentConversation() {
    if (!state.activeConversationId || state.loading) return;
    await request(`/api/conversations/${state.activeConversationId}`, {
      method: "DELETE",
    });
    state.activeConversationId = null;
    await loadConversations();
    if (state.conversations.length === 0) {
      await createConversation();
      return;
    }
    await loadConversation(state.conversations[0].id);
  }

  async function uploadFiles() {
    const files = Array.from(els.uploadInput.files || []);
    if (files.length === 0) {
      setUploadStatus("请先选择至少一个 Markdown 文件。", true);
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    els.uploadButton.disabled = true;
    setUploadStatus("正在上传并写入知识库...", false);

    try {
      const data = await requestJson("/api/upload", {
        method: "POST",
        body: formData,
      });
      setUploadStatus(
        `上传完成，共处理 ${data.file_count} 个文件，新增 ${data.total_chunks} 个文本块。`,
        false
      );
      els.uploadInput.value = "";
    } catch (error) {
      setUploadStatus(`上传失败：${error.message}`, true);
    } finally {
      els.uploadButton.disabled = false;
    }
  }

  function setLoading(loading) {
    state.loading = loading;
    els.sendButton.disabled = loading;
    els.chatInput.disabled = loading;
    els.newConversation.disabled = loading;
    els.deleteConversation.disabled = loading;
  }

  async function streamChat(question) {
    const response = await request(
      `/api/conversations/${state.activeConversationId}/chat/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, top_k: 3 }),
      }
    );

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let delimiterIndex = buffer.indexOf("\n\n");
          while (delimiterIndex !== -1) {
            const rawEvent = buffer.slice(0, delimiterIndex);
            buffer = buffer.slice(delimiterIndex + 2);
            const line = rawEvent
              .split("\n")
              .find((item) => item.startsWith("data: "));
            if (line) {
              yield JSON.parse(line.slice(6));
            }
            delimiterIndex = buffer.indexOf("\n\n");
          }
        }
      },
    };
  }

  async function sendMessage(question) {
    if (!question || state.loading) return;
    const conversation = getActiveConversation();
    if (!conversation) return;

    setLoading(true);
    appendLocalMessage({ role: "user", content: question, sources: [] });

    const assistantMessage = { role: "assistant", content: "", sources: [] };
    appendLocalMessage(assistantMessage);

    try {
      const stream = await streamChat(question);
      for await (const event of stream) {
        if (event.type === "sources") {
          assistantMessage.sources = event.sources || [];
          renderMessages();
        } else if (event.type === "chunk") {
          assistantMessage.content += event.content || "";
          renderMessages();
        } else if (event.type === "done") {
          assistantMessage.content = event.answer || assistantMessage.content;
          break;
        } else if (event.type === "error") {
          throw new Error(event.message || "流式输出失败");
        }
      }

      await loadConversations();
      await loadConversation(state.activeConversationId);
    } catch (error) {
      assistantMessage.content =
        error.message || "请求失败，请检查 API 地址和后端日志。";
      renderMessages();
    } finally {
      setLoading(false);
    }
  }

  async function bootstrap() {
    els.apiBaseInput.value = state.apiBase;

    els.saveApiBase.addEventListener("click", async () => {
      state.apiBase = normalizeApiBase(els.apiBaseInput.value.trim());
      localStorage.setItem(API_BASE_KEY, state.apiBase);
      try {
        await requestJson("/api/health");
        setStatus("后端连接正常。", false);
        if (state.conversations.length === 0) {
          await loadConversations();
          if (state.conversations.length === 0) {
            await createConversation();
          } else {
            await loadConversation(state.conversations[0].id);
          }
        }
      } catch (error) {
        setStatus(`连接失败：${error.message}`, true);
      }
    });

    els.newConversation.addEventListener("click", createConversation);
    els.deleteConversation.addEventListener("click", deleteCurrentConversation);
    els.uploadButton.addEventListener("click", uploadFiles);
    els.chatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = els.chatInput.value.trim();
      if (!question) return;
      els.chatInput.value = "";
      await sendMessage(question);
    });

    if (!state.apiBase) {
      setStatus("请先配置 FastAPI 地址，然后保存。", true);
      return;
    }

    try {
      await requestJson("/api/health");
      setStatus("后端连接正常。", false);
      await loadConversations();
      if (state.conversations.length === 0) {
        await createConversation();
      } else {
        await loadConversation(state.conversations[0].id);
      }
    } catch (error) {
      setStatus(`连接失败：${error.message}`, true);
    }
  }

  bootstrap();
})();
