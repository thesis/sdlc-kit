---
type: spec
owner: <name>
relates: <intent URL>, <plan PR URL>
---

# Spec: <name>

## 1. Terms
<!-- One table. Each term has one meaning. Use each term with that meaning every time. -->

## 2. Scope
<!-- What is in, and what is out. -->

## 3. Requirements
<!-- Numbered R1, R2, ... Functional requirements first, then non-functional ones. A test can prove each requirement. -->

## 4. How it works
<!-- A diagram of the components first, then the flows. A reader who is not an engineer can follow this section. -->

## 5. Worked example
<!-- Exact numbers where money or limits are involved. -->

## 6. Roles and permissions
<!-- Who can do what, and who holds each role. -->

## 7. Deliverables
<!-- The list that the plan maps onto files and tests. -->

## 8. Trade-offs
<!-- Two things that the intent wants and that the design cannot give in full at the same time. Say which one wins and what that costs. -->

## 9. Risks
<!-- Numbered: 1., 2., ... Each risk is a failure mode we accept, with its response. "Accepted, no action" is a valid response. -->

## 10. Open decisions
<!-- Numbered: 1., 2., ... Each open decision has an owner and a date. Write "None." when no open decision is left. -->

## 11. Intent open problems, answered
<!-- Each open problem of the intent, with its answer or its owner. -->

<!--
Not here: function signatures, storage, deploy scripts, test names and script CLIs. Those belong in the plan.

A trade-off example from the Robinhood spec: depositors may withdraw at any time, and the buffer must hold utilization at 90%. Withdrawals win, so the buffer is unstable by design, and monitoring repairs it.

Trade-offs come before risks, because the risks follow from which side of each trade-off wins. Section 11 is the done check of the playbook for the spec.
-->
