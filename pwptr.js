#!/usr/bin/env node
/* eslint-disable one-var */
const fs = require('fs'),
  yargs = require('yargs'),
  chalk = require('chalk'),
  readline = require('readline'),
  {getProfileDirByMode} = require('./puppeteer-helper')

let config = {
    taskDir: `${__dirname}/../../tasks`,
  }

let configFile = `${__dirname}/../../.pwptr.json`
if (fs.existsSync(configFile)) {
  let userConfig = require(configFile)
  config = {...config, ...userConfig}
}

const errorTxt = txt => chalk.bold.white.bgRed(txt),
  headerTxt = txt => chalk.yellow(txt),
  cmdTxt = txt => chalk.green(txt),
  exportedTasks = [],
  // simple hash of namespaces for easy iterating over w/o examining all exported tasks
  exportedTasksNamespaces = []

const delFile = async (file, confirmMsg = `Are you sure you want to delete ${file}?`) => {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout})
  const it = rl[Symbol.asyncIterator]()
  console.log(confirmMsg + '\n(y/n): ')
  const answer = await it.next()
  if (answer.value === 'y') {
    try {
      fs.unlinkSync(file)
      console.log('Successfully removed ${file}')
    } catch (error) {
      if (error.code === 'ENOENT') { // do not exit with error for this case
        console.log('Does not exist or already removed.')
      } else {
        console.error(errorTxt(`Failed to remove: ${file}\n${error}`))
        process.exit(1)
      }
    }
  }
  rl.close()
}

const parseTaskFiles = function () {
  if (!fs.existsSync(config.taskDir)) {
    console.error(errorTxt(`Task dir "${config.taskDir}" does not exist.`))
    process.exit(1)
  }
  fs.readdirSync(config.taskDir).forEach(file => {
    if (/\.js$/.test(file)) {
      modExports = require(`${__dirname}/../../${config.taskDir}/${file}`)
      for (const [key, value] of Object.entries(modExports)) {
        let n = value.namespace
        // if the task already exists or its namespace matches an existing task, error out
        if (exportedTasks[key] || exportedTasks[n]) {
          console.error(errorTxt(`Exported task or task group name "${key}" already exists. Each must be globally unique.`))
          process.exit(1)
        } else {
          exportedTasksNamespaces[n] = n
          exportedTasks[key] = value
        }
      }
    }
  })
}

const normalizeTaskSet = function(tasks) {
  const taskNamespacesToExpand = [],
    tasksToRun = []
  tasks.forEach(t => {
    if (!exportedTasks[t] && !exportedTasksNamespaces[t]) {
      console.error(errorTxt(`Task or group of tasks "${t}" does not exist.`))
      process.exit(1)
    }
    if (exportedTasksNamespaces[t]) {
      taskNamespacesToExpand[t] = true
    } else {
      tasksToRun.push(t)
    }
  })
  // iterate over ALL exported tasks to see if that task's namespace matches an item from the user's input
  // if so, add it (and other matches) to the list of tasks to run
  // by iterating over ALL exported tasks, only 1 loop and 1 comparison per task is needed
  for (const [key, value] of Object.entries(exportedTasks)) {
    if (taskNamespacesToExpand[value.namespace]) {
      tasksToRun.push(key)
    }
  }

  // dedup using sets
  const taskSet = new Set(tasksToRun)
  if (taskSet.size !== tasks.length) {
    console.log(`Filtering ... 1 or more duplicate tasks provided or within a task group. ${headerTxt('Task run order no longer guaranteed.')}`)
  }
  return taskSet
}

const addExtModeOpts = function (yargs) {
  const defaults = {
    global: false,
    type: 'boolean',
    default: false
  }
  yargs.option('dev', { ...defaults,
    description: 'Applies to profile with dev extension',
  })
  yargs.option('prod', { ...defaults,
    description: 'Applies to profile with prod extension',
  })
  yargs.option('none', { ...defaults,
    description: 'Applies to profile with no extension',
  })
}

yargs.command(
  ['list'],
  'Show list of tasks',
  () => {},
  argv => {
    parseTaskFiles()
    let namespace
    for (const [key, value] of Object.entries(exportedTasks)) {
      if (namespace !== value.namespace) {
        ({namespace} = value)
        console.log('\n' + headerTxt(value.namespace))
      }
      console.log(`    ${cmdTxt(key)}: ${value.description}`)
    }
  }
)
yargs.command(
  ['clear-cookies'],
  'Remove cookies for the specified extension modes',
  addExtModeOpts,
  async argv => {
    if (argv.dev) {
      await delFile(getProfileDirByMode('dev') + '/Default/Cookies', 'Delete cookies for browser with dev extension?')
    }
    if (argv.prod) {
      await delFile(getProfileDirByMode('prod') + '/Default/Cookies', 'Delete cookies for browser with prod extension?')
    }
    if (argv.none) {
      await delFile(getProfileDirByMode('null') + '/Default/Cookies', 'Delete cookies for bare (no extension) browser?')
    }
  }
)

yargs.command(
  ['run [tasks...]'],
  'Run a list of tasks with the specified options.',
  yargs => {
    addExtModeOpts(yargs)
    yargs.option('screenshot',{
      description: 'Screenshot the page after each task is run.',
      global: false,
      type: 'boolean',
      default: true
    })
    yargs.option('devtools',{
      description: 'Run the task with devtools open. Often used with --no-close option.',
      global: false,
      type: 'boolean',
      default: false
    })
    yargs.option('no-close',{
      description: 'Keep the browser open after each task.',
      global: false,
      type: 'boolean',
      default: false
    })
    yargs.positional('tasks', {
      type: 'string',
      describe: 'A list of tasks',
    })
  },
  async argv => {
    argv.tasks = argv.tasks || []
    parseTaskFiles()
    let tasks = normalizeTaskSet(argv.tasks)
    for (let t of tasks) {
      console.log(`Running ${cmdTxt(t)} ...`)
      //let p = await exportedTasks[t].run({extMode: 'dev', devtools: argv.devtools})
      let p = await exportedTasks[t].run()
      if (argv.screenshot) {
        p.screenshot({fullPage: true})
      }
      if (argv.close) {
        p.browser().close()
      }
    }
  }
)

yargs
  .usage(cmdTxt('$0 <cmd> [args]'))
  .wrap(yargs.terminalWidth())
  .strict()
  .updateStrings({
    'Commands:': headerTxt('Commands:'),
    'Options:': headerTxt('Options:     ** Commands may have additional options. See <cmd> -h. **'),
    'Positionals:': headerTxt('Positionals:'),
    'Not enough non-option arguments: got %s, need at least %s': errorTxt(
      'Not enough non-option arguments: got %s, need at least %s'
    )
  })
  .alias('h', 'help')
  .check(arg => {
    if (!arg._.length) {
      yargs.showHelp()
    }
    return true
  }, true)
  .version(false)

;(async () => {
  yargs.argv
})()