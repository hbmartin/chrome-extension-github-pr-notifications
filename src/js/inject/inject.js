(function () {
    const Status = {
        IN_PROGRESS: 'in_progress',
        FAILED: 'failed',
        SUCCESS: 'success'
    }

    const TargetNode = document.getElementsByClassName("discussion-timeline-actions")[0];
    const State = {
        "completed": undefined,
        "ciStatus": {},
		"comments": []
    };

    function getStatusList(target) {
        let statusList = target.getElementsByClassName("merge-status-list js-updatable-content-preserve-scroll-position")
        if (statusList.length > 0) {
            return statusList[0];
        }
        return undefined;
    }

    function checkCompleted(target, completionCallback) {
        let statusList = getStatusList(target);
        if (statusList !== undefined) {

            let actionItemIcons = statusList.parentNode.getElementsByClassName("branch-action-item-icon");
            if (actionItemIcons.length >= 1) {
                let svgs = actionItemIcons[0].getElementsByTagName("svg");
                if (svgs.length > 0) {
                    if (svgs[0].classList.contains("octicon-check")) {
                        if (!State["completed"]) {
                            if (typeof completionCallback === 'function') {
                                completionCallback()
                            }
                        }
                        State["completed"] = true;
                    } else {
                        if (State["completed"]) {
                            State["ciStatus"] = {};
                        }
                        State["completed"] = false;
                    }
                }
            }
        }
    }

    function checkStatuses(target, failureCallback) {
        let statusList = getStatusList(target);
        if (statusList !== undefined) {
            let statusItems = statusList.getElementsByClassName("merge-status-item");
            for (let item of statusItems) {
                let itemNameCandidates = item.getElementsByClassName("text-emphasized");
                if (itemNameCandidates.length === 0) {
                    continue
                }
                let itemName = itemNameCandidates[0].innerText.trim();

                if (!(itemName in State["ciStatus"]) || State["ciStatus"][itemName] === Status.IN_PROGRESS) {
                    let svgs = item.getElementsByTagName("svg");
                    if (svgs.length > 0) {
                        let iconSvg = svgs[0];
                        let inProgress = iconSvg.classList.contains("color-yellow-7");
                        if (inProgress) {
                            State["ciStatus"][itemName] = Status.IN_PROGRESS;
                        } else {
                            let didFail = iconSvg.classList.contains("text-red");
                            // const didSucceed = iconSvg.classList.contains("text-green");
                            if (didFail) {
                                State["ciStatus"][itemName] = Status.FAILED;
                                if (typeof failureCallback === 'function') {
                                    failureCallback(itemName)
                                }
                            } else {
                                State["ciStatus"][itemName] = Status.SUCCESS;
                            }
                        }
                    }
                }
            }
        }
    }

    checkCompleted(TargetNode, () => {
        console.log(`CI completed on load`)
    });
    checkStatuses(TargetNode, (itemName) => {
        console.log(`Ignoring failure for ${itemName}`)
    });

    function observeDom() {
        const callback = function (mutationsList, observer) {
            for (let mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    checkCompleted(mutation.target, () => {
                        chrome.runtime.sendMessage({content: "✅ CI successful"}, (response) => {
                        });
                    });

                    if (!State["completed"]) {
                        checkStatuses(mutation.target, (itemName) => {
                            chrome.runtime.sendMessage({content: `❌ ${itemName}`}, (response) => {
                            });
                        });
                    }
                } else {
                    console.log("Mutation type unknown")
                    console.log(mutation);
                }
            }
        };

        const observer = new MutationObserver(callback);
        observer.observe(TargetNode, {"childList": true, "subtree": true});
    }

    observeDom();
})();
