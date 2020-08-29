console.log("inject.js");

const targetNode = document.getElementsByClassName("discussion-timeline-actions")[0];

function initiallyComplete() {
	const actionItemIcons = targetNode.getElementsByClassName("branch-action-item-icon");
	if (actionItemIcons.length >= 2) {
		const svgs = actionItemIcons[1].getElementsByTagName("svg");
		if (svgs.length > 0) {
			return svgs[0].classList.contains("octicon-check");
		}
	}
	return false;
}

const ghProgresState = {
	"completed": initiallyComplete(),
	"ciStatus": {}
};
// todo: scan individual CI at launch

function observeDom() {
	const callback = function(mutationsList, observer) {
		for (let mutation of mutationsList) {
			if (mutation.type === 'childList') {
				const actionItemIcons = mutation.target.getElementsByClassName("branch-action-item-icon");
				if (actionItemIcons.length >= 2) {
					const svgs = actionItemIcons[1].getElementsByTagName("svg");
					if (svgs.length > 0) {
						if (svgs[0].classList.contains("octicon-check")) {
							if (!ghProgresState["completed"]) {
								chrome.runtime.sendMessage({ content: "✅ CI successful" }, (response) => {});
							}
							ghProgresState["completed"] = true;
						} else {
							if (ghProgresState["completed"]) {
								ghProgresState["ciStatus"] = {};
							}
							ghProgresState["completed"] = false;
						}
					}
				}
				if (!ghProgresState["completed"]) {
					const statusList = mutation.target.getElementsByClassName("merge-status-list js-updatable-content-preserve-scroll-position")
					if (statusList.length > 0) {
						const statusItems = statusList[0].getElementsByClassName("merge-status-item");
						for (let item of statusItems) {
							const itemNameCandidates = item.getElementsByClassName("text-emphasized");
							if (itemNameCandidates.length == 0) { continue }
							const itemName = itemNameCandidates[0].innerText.trim();
							
							if (!(itemName in ghProgresState["ciStatus"]) || ghProgresState["ciStatus"][itemName] == "in_progress") {
								const svgs = item.getElementsByTagName("svg");
								if (svgs.length > 0) {
									const iconSvg = svgs[0];
									const inProgress= iconSvg.classList.contains("color-yellow-7");
									if (inProgress) {
										ghProgresState["ciStatus"][itemName] = "in_progress";
									} else {
										const didFail = iconSvg.classList.contains("text-red");
										// const didSucceed = iconSvg.classList.contains("text-green");
										if (didFail) {
											ghProgresState["ciStatus"][itemName] = "fail";
											chrome.runtime.sendMessage({ content: "❌ " + itemName }, (response) => {});
										} else {
											ghProgresState["ciStatus"][itemName] = "success";
										}
									}
								}
							}
						}
					}
				}
			} else {
				console.log("Mutation type unknown")
				console.log(mutation);
			}
		}
	};

	const observer = new MutationObserver(callback);
	observer.observe(targetNode, {"childList": true, "subtree": true});
}

observeDom();

// observer.disconnect();
