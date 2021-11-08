#!/usr/bin/env node

// File used to setup the pwptr cli for a project
// - looks for a .pwptr.json
// - resolves config between user and defaults
// - validates config
// - interacts with user for certain commands

/* eslint-disable one-var */
const fs = require('fs'),
  path = require('path'),
  yargs = require('yargs'),
  chalk = require('chalk'),
  readline = require('readline'),
  {clearCookies} = require('pwptr')
  configDir = path.resolve(`${__dirname}/../..`)
  configFile = `${configDir}/.pwptr.json`,
  defaultProfileOpts = {
    'exts': [],
    'runByDefault': false,
    'devtools': false,
    'screenshot': false,
    'autoclose': true
  },
  errorTxt = txt => chalk.bold.white.bgRed(txt),
  headerTxt = txt => chalk.yellow(txt),
  cmdTxt = txt => chalk.green(txt),
  exportedTasks = [],
  // simple hash of namespaces for easy iterating over w/o examining all exported tasks
  exportedTasksNamespaces = []

const resolveConfigPath = function (p) {
  p = p.replace('{HOME}', process.env.HOME)
  if (!/^(\.|\/)/.test(p)) { // relative path not prefixed with "./"
    p = './' + p
  }
  if (/^\.{1,2}\//.test(p)) { // relative path
    p = path.resolve(`${configDir}/${p}`)
  }
  return p
}

// if user supplied config file exists, use it
config = fs.existsSync(configFile) ? require(configFile) : {}

// if a tasks dir was not provided, define default
if (typeof config.tasksDir === 'undefined') {
  config.tasksDir = `${configDir}/tasks`
}

config.tasksDir = resolveConfigPath(config.tasksDir)
if (!fs.existsSync(config.tasksDir)) {
  console.error(errorTxt(`Resolved tasks directory "${config.tasksDir}" does not exist.`))
  process.exit(1)
}

// if a tasks output dir was not provided, define default
if (typeof config.tasksOutputDir === 'undefined') {
  config.tasksOutputDir = config.tasksDir + '/output'
}

config.tasksOutputDir = resolveConfigPath(config.tasksOutputDir)
if (!fs.existsSync(config.tasksOutputDir)) {
  try {
    fs.mkdirSync(config.tasksOutputDir)
  } catch (e) {
    console.error(errorTxt(`Could not create resolved tasks output directory "${config.tasksDir}".`))
    process.exit(1)
  }
}

// if profiles were not provided, define default
if (typeof config.profiles === 'undefined') {
  config.profiles = {
    // if not provided default profile should run by default
    'default': {...defaultProfileOpts, 'runByDefault': true}
  }
} else {
  // provide default values for any omitted by user
  for (const [key, value] of Object.entries(config.profiles)) {
    config.profiles[key] = {...defaultProfileOpts, ...value}
  }
}

// ensure provided extensions are valid
for (const [key, value] of Object.entries(config.profiles)) {
  let paths = config.profiles[key].exts
  if (typeof paths.forEach !== 'function') { // test if array by checking for "forEach" method
    console.error(errorTxt(`${configFile}'s profile "${key}" contains an invalid "exts" key.
It should be an array of paths of Chrome extensions to load.`))
    process.exit(1)
  }
  paths.forEach((p, i) => {
    p = resolveConfigPath(p)
    if (!fs.existsSync(p)) {
      console.error(errorTxt(`${configFile}'s profile "${key}" contains "exts" with invalid resolved path:\n${p}.`))
      process.exit(1)
    } else {
      config.profiles[key].exts[i] = p
    }
  })
}

// if profile dir was not provided, define default
if (typeof config.profilesDir === 'undefined') {
  config.profilesDir = config.tasksDir + '../.chrome-profiles'
}

// if profile dir does not exist, create it
config.profilesDir = resolveConfigPath(config.profilesDir)
if (!fs.existsSync(config.profilesDir)) {
  try {
    fs.mkdirSync(config.profilesDir)
  } catch (e) {
    console.error(errorTxt(`Could not create directory for Chrome profiles "${config.profilesDir}".`))
    process.exit(1)
  }
}

// after validating extensions of profiles, create chrome profile dirs if they do not exist
for (const [key, value] of Object.entries(config.profiles)) {
  let profileDir = `${config.profilesDir}/${key}`
  if (!fs.existsSync(profileDir)) {
    try {
      fs.mkdirSync(profileDir)
    } catch (e) {
      console.error(errorTxt(`Could not Chrome profile directory "${profileDir}".`))
      process.exit(1)
    }
  }
}

const parseTaskFiles = function () {
  fs.readdirSync(config.tasksDir).forEach(file => {
    if (/\.js$/.test(file)) {
      modExports = require(`${config.tasksDir}/${file}`)
      for (const [key, value] of Object.entries(modExports)) {
        let n = value.namespace
        // if the task already exists or its namespace matches an existing task, error out
        if (exportedTasks[key] || exportedTasks[n]) {
          console.error(errorTxt(`Exported task or task group name "${key}" already exists. Each must be globally unique.`))
          process.exit(1)
        } else {
          if (n) {
            exportedTasksNamespaces[n] = n
          }
          exportedTasks[key] = value
        }
      }
    }
  })
  if (!Object.keys(exportedTasks).length) {
    console.error(errorTxt(`No exported tasks found in "${config.tasksDir}/*.js" file(s).`))
    process.exit(1)
  }
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

const addProfilesOpt = function (yargs) {
  yargs.option('p', {
    alias: 'profiles',
    description: 'list of profiles',
    choices: Object.keys(config.profiles)
  })
}

yargs.command(
  ['clear-cookies'],
  'Remove cookies for the specified extension modes',
  addProfilesOpt,
  async argv => {
    if (!argv.profiles) {
      yargs.showHelp()
      // invoked by command handler so must explicitly invoke console
      console.error(errorTxt(`The "${argv._[0]}" command requires 1 or more profiles.`))
      process.exit(1)
    }
    if (argv.profiles) {
      const rl = readline.createInterface({input: process.stdin, output: process.stdout})
      const it = rl[Symbol.asyncIterator]()
      console.log(confirmMsg + '\n(y/n): ')
      const answer = await it.next()
      rl.close()
      if (answer.value === 'y') {
        try {
          clearCookiesByProfile(p)
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

      await delFile(getProfileDirByMode('dev') + '/Default/Cookies', 'Delete cookies for ${}?')
    }
  }
)

yargs.command(
  ['run [tasks...]'],
  'Run a list of tasks with the specified options.',
  yargs => {
    addProfilesOpt(yargs)
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
    yargs.option('autoclose',{
      description: 'Close the browser after each task.',
      global: false,
      type: 'boolean',
      default: true
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
      let p = await exportedTasks[t].run({config: config, argv: argv})
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