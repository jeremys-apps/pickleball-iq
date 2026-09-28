---
name: review-queue
description: Walk Jeremy through extracted tips flagged for human review, showing transcript context, and record approve, reject or edit decisions. Use when asked to review tips or work the review queue.
argument-hint: "[episode_id] (optional: limit to one episode)"
---

# Review queue

1. Run `python pipeline/piq.py review-list` and read the JSONL it prints (one tip per line). If `$ARGUMENTS` names an episode, keep only tips whose `episode_id` matches.
2. If the queue is empty, say so and stop.
3. Present tips in batches of five. For each tip show:
   - the tip in one or two plain sentences (situation, action, why if any)
   - speaker and tier, endorsement status and endorser
   - the review reasons
   - the transcript context: about eight lines around `timestamp_start` from `${PIQ_DATA_DIR:-../pickleball-iq-data}/work/prepared/<episode_id>.md`
   - the timestamp, so Jeremy can check the audio
   - your recommendation (approve, reject, or a specific edit) with one line of reasoning
4. Ask for decisions for the batch. Accept short replies such as "1 approve, 2 reject, 3 edit status to endorsed_implicit, 4 and 5 approve".
5. Record each decision:
   - `python pipeline/piq.py review-decide <tip_id> approve --note "<short note>"`
   - `python pipeline/piq.py review-decide <tip_id> reject --note "<reason>"`
   - `python pipeline/piq.py review-decide <tip_id> edit --set endorsement.status=endorsed_implicit --set action="<new text>" --note "<reason>"`
6. If Jeremy says to accept your recommendations (for this batch or everything left), record each as you recommended with the note "Accepted Claude's recommendation". Keep recommendations conservative: when only the audio can settle a tip, recommend that he listen rather than guessing.
7. Continue until the queue is empty or Jeremy stops. Finish with counts of approved, rejected and edited tips.

Never record a decision Jeremy did not make. If he is unsure about one, leave it in the queue.
