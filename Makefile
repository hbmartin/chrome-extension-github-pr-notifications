zip:
	zip -r "githubpr-notifications-v`grep "\"version\"" src/manifest.json | cut -f2 -d':' | tr -d '" ,'`.zip" src

tag:
	git diff-index --quiet HEAD --  # checks for unstaged/uncomitted files
	git tag "v`grep "\"version\"" src/manifest.json | cut -f2 -d':' | tr -d '" ,'`"
	git push --tags

check-master:
	if [[ `git rev-parse --abbrev-ref HEAD` != "master" ]]; then exit 1; fi

pull:
	git pull

release: check-master pull tag zip
