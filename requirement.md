I'm now working on a take-home assignement from an AI start up Mirendil https://mirendil.com/

The take home description is such: 

The take-home includes three project options:

Chat Trace Viewer
Cloud Agent Chat
Harness Async Tool
Please choose and complete only one of the three options. You do not need to complete all three.

The exercise is designed to help us understand how you think, your product and technical judgment, and how you approach open-ended problems.

Your submission should include:

An ideas document
Code and a README with setup instruction


===

Please carefully follow all instructions and work independently. You may use AI tools or documentation as resources, but please note what you used in your submission. Your assessment results will be carefully considered by Mirendil as part of our evaluation process.

=== 

Question: Chat Trace Viewer

Background

We work with LLM traces. When something breaks (e.g. a bad tool call, a wrong answer, a slow turn) an engineer needs to go in and find out why. Build a tool for loading, reading, and debugging traces to help any engineer any issues such as model, harness, or infra. The tool should work well with code agents.

Build a debugging trace viewer that works end to end.

The total time will be 6 hours. Be sure to spend 15 minutes or so to write the reasoning behind your decisions. The project will be evaluated on thoughtfulness of features, level of productionization, and code quality.

What to build

Requirements

A zip file that contains your code.
A README for how to run the app (be sure to include example traces and connectors).
A short report of UX and architecture decisions with motivations.

Suggestions

Load a trace by pasting text or uploading a file or url.
See the conversation clearly by message type.
Features to deal with very long traces.
Stats about the trace.
Handling more than one trace format.
Ability to view the raw trace.

Worth thinking about
You decide how far to take each of these. We mostly care about the choices you make and why.

Format normalization for extensibility.
How easy is it for someone to get value from the tool.
How to handle persistence UX wise and architecture wise.
How someone would share a trace with a teammate.
Code patterns you like to use.
How you keep the code clean.
Any optimizations you made.

Notes
Use whatever stack you're the most experienced in.
Keep the scope small and finish it. A tight, working tool beats a big half-built one. Budget around 4 hours to build, 1 hour to QA, 1 hour to review the code; if you run out of time, be sure to write down what's left.
Make reasonable assumptions and note them. Handle the edge cases you think matter (bad input, empty trace, huge trace, etc).

我之前写过一个这样的Tool, 所以我觉得问题不大。
可以参考的同类产品：
https://github.com/langfuse/langfuse
https://github.com/evilmartians/agent-prism
https://langfuse.com/docs/observability/overview

我们首先列出一些计划，例如如何实现，步骤，以及不同的阶段，使得我们每个步骤都有计划-实现-验收-扩展的阶段。

我的想法是这样：
我们需要实现一个llm 训练的trace viewer, 那么首先我们需要文件，所以我们需要准备一些input, 我觉得可以弄成json, 然后里面每个trace需要有一些format。我们需要首先设计这些format
简易的版本：

trace 
首先是metadata
component name (the dataset's name)
instance id (the task's id)
trace id (trace's id)
status (completed / failed / executing etc)
time stamp
data location


然后一些统计数据
score 
has error
truncated
model option (the llm's config, context window, temp, topp, name etc)
input/output/thinking token
turns
tool uses
sandbox execution
thinking portion 
probs (the logits of each token)

然后来回的对话,
我们用https://developers.openai.com/cookbook/articles/openai-harmony 这个format，来进行parse
https://github.com/openai/harmony

user 
assistant
developer
thinking
这些都有

以及它们的token prob（需要visualize token prob/idx 的时候用）

然后这些应该都支持被索引 就是我们在tool里面应该可以很快搜索到关键词之类的 

我们需要首先生成一些各种类型的trace 我们可以弄成本地文件

我想你首先写一个生成这些trace的tool
可以是一个比如模拟的tool 一个webapp
然后这个里面可以生成user <> llm chat messages
可以多种模式，例如只有对话（支持thinking），有tool call，有sandbox execution + results之类的 涵盖 search, tool call, code execution, sandbox terminal interaction etc 不同的情形

与此同时生成一些模拟的llm 训练和测试的这些数据（traces），涵盖stem, math, swe, terminal, search (tool call) 的情形

可以参考openai harmony 的格式

我觉得比如components：
stem, swe, terminal, search
然后stem 里面可以是 math deepscaler，例如https://huggingface.co/datasets/agentica-org/DeepScaleR-Preview-Dataset 这里 这些应该是1turn的 ，这里math verify的output 1/0 所以是直接程序化的score
自然科学可以是 https://huggingface.co/datasets/nvidia/Nemotron-RL-Science-v1 这里也是1turn，但是需要是llm as judge 的response，也就是 他的reward应该是1/0 但是是包含llm judge output
swe我们可以用 https://huggingface.co/datasets/MariusHobbhahn/swe-bench-verified-mini 然后这里应该有代码的source（出处，diff），然后llm 调用的各种命令和tools，然后系统的output，以及最后测试的scores 
terminal 我们可以用 https://huggingface.co/datasets/ia03/terminal-bench 类似这个 然后这里应该有llm调用的命令，terminal的response，之类的，以及最后的scores
code 我们可以用https://huggingface.co/datasets/newfacade/LeetCodeDataset 
然后search 我们可以用 例如https://huggingface.co/datasets/Tevatron/browsecomp-plus 这个 应该有调用的search tool的query，然后返回的结果 然后最后reward 

然后每个都应该有timestamp之类的 支持之后traceview来做timeline profiling，以及各种所需要的visualization例如train/test step，每一个类别都生成10个instances，以及每个instances生成16个rollouts，其中每个instances都确保至少跑过三个steps

我的目的是
然后我们想实现的是一个webapp，然后可以本地跑

基本上有两个页面：
一个是homepage，这里面我觉得可以是一个侧边栏，然后另一边显示所有的trace

另一个是trace detail， 这里面我们可以看到所有和这个trace相关的（也可以是一个subpage，也就是说点进去一个trace只是展开这个页面 而不是进入到一个新的页面

我放上了大概的layout的方式 你可以在其中看看 

我有许多feature 都想实现 但是现在我们一步一步来 所以先focus on generating data, 然后mvp on basic trace list and viewer, then filters function, and then trace detailed pages

我们首先把plan 和 features，还有要使用的techincal stack都记录一下，然后把所有的进展放在progress.md 里面（加上要记住的点）；这些都要随着我们的develop随时更新。

/Users/mingrui/Documents/codes/interview/coding/traceviewsource 这里面有一些我现在的实现和手画的截图

draft_homepage_list.HEIC draft_homepage_layout.HEIC draft_homepage_components.HEIC 是homepage的layout，有各种不同的 grid, 包括 filters, components, lists, 还有reward curve
draft_tracepage.HEIC 是trace view detail的page layouts 包括如何render messages，metadata，timeline，还有evolution graph（显示这个task在不同step的rollout的表现 

然后其他的都是一些具体实现的图, 你可以根据文件名来看渲染的结果 

我们不一定按照这些视觉实现 但是这些是一些starter points. 



# Step 2

